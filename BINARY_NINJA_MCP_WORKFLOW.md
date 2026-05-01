# Binary Ninja MCP Workflow and Exact Replication Guide

This is the canonical process for recovering Tunnet packet behavior from `tunnet.exe.bndb` and reproducing it in code.

---

## 1) Hard MCP rule (critical)

Use **exactly one Binary Ninja MCP request at a time**.

- Never batch/parallelize Binary Ninja MCP calls.
- Wait for each response before issuing the next call.
- Multi-request patterns frequently cause:
  - `Connection closed`
  - `Not connected`

If disconnected, see recovery steps below.

---

## 2) Preconditions

- Binary Ninja running
- `tunnet.exe.bndb` loaded and focused
- MCP server `user-binary_ninja_mcp` available

---

## 3) Tooling used

- `list_binaries`
- `list_imports`
- `get_xrefs_to`
- `decompile_function`
- `get_il`
- `list_strings_filter`
- `get_data_decl`

---

## 4) Proven call chain (network + scheduler)

### Socket wrappers (ground truth send path)

- `sub_142345c30`, `sub_142346810` -> `send`
- `sub_142367ae0` -> `sendto`
- `sub_142345a90`, `sub_142345c90`, `sub_14235a330` -> `WSASend`

### Upstream scheduler path

- `sub_1402f5840` (driver / endpoint processing loop)
- `sub_1402f9a40` (packet generation and tick/address gates)

### Tick source

Inside `sub_1402f5840`:

- `*arg11 = zx.d((*arg11).w + 1)`
- same `*arg11` passed to `sub_1402f9a40(..., arg4)`

So `arg4` in `sub_1402f9a40` is the scheduling tick/counter.

---

## 5) Confirmed behavior (binary-backed)

### A) Deterministic tick gating (not random min/max interval)

`sub_1402f9a40` uses bit/shift gates like:

- `(arg4 & 1)`
- `(arg4 & 3)`
- `(arg4 & 7)`
- `((arg4 >> 1) & 3)`
- larger windows (`>>7`, `>>9`) in some branches

### B) Address tuple driven branching

Packet profile choice depends on tuple components read from `arg3`:

- `a = arg3[0]`
- `b = arg3[1]`
- `c = arg3[2]`
- `d = arg3[3]`

### C) Wildcard matcher semantics

`sub_1406b6550` confirms matching with per-octet wildcard `0`:

- rule octet `0` => wildcard
- otherwise exact compare against corresponding `arg2` octet

### D) Random selection exists in game logic

`sub_140673b40` / `sub_140673740` perform uniform sampling over candidate arrays using internal RNG state (`sub_1406734a0` feeds entropy/state refresh).

This means destination/message candidate selection is not a fixed hash; game uses RNG-backed sampling.

### E) Same-tick receive/send interaction

In endpoint processing within `sub_1402f5840`, packet slot/state fields are rewritten across nested loops (**§E.1a**–**§E.1b**). Summary:

- **Merge tail (`0x1402f75bf`):** on the **`0x1402f965f`** inner-loop spine, HLIL places **`0x1402f5bfe` before** the **`label_1402f90e8` → `r8_13.b = 2` → `0x1402f75bf`** merge, so **`sub_1402f9a40` does not consume that fresh `= 2` on the same inner-loop spin**; the next **`0x1402f5bfe`** is a **later** evaluation (**often** `rdi_43` advance **inside** the same **`sub_1402f5840`**, or the next **`NetTock`**—see **§E.1a**).
- **Jump-table / infection (`0x1402f5bdb`):** **`*(rbx_30 + 0x7a) = 2`** is followed by the **`+0x98`** slot walk and **`rdi_43 = rbp_3`**; the **next** inner-loop iteration can hit **`0x1402f5bfe`** with **`==2`** and call **`sub_1402f9a40` in the same `sub_1402f5840` invocation`** (**§E.1a**, CFG).
- **Multi-slot endpoints:** extra packet records are **`+0x98`** apart (**§E.1a**); each has its own **`+0x7a`**.
- **`SendBack` / `PacketDrop` strings:** MCP xrefs are **serde / JSON / particle UI** classifiers (**§E.1b**), not proof of where **wrong-address wire bounce** lives.

**TypeScript hook:** `RecoveredSlotTickContext` + optional 4th argument to **`evaluateEndpointSend`** in **`src/recovered-endpoint-scheduler.ts`**. When **`receiveOrBounceClaimedSlot: true`**, the recovered model returns **`shouldSend: false`** with reason **`same-tick slot: receive/bounce claimed`** so export/compare can opt in once inbound simulation sets the flag. Call sites that omit the argument behave as before.

**MCP / BN check (`decompile_function sub_1402f5840`, stock `tunnet.exe.bndb`):**

- **`0x1402f5bfe`**: `if (*(rbx_3 + 0x7a) == 2)` immediately before **`sub_1402f9a40`** @ **`0x1402f5c26`** (full header/subject composer).
- **`0x1402f5cc1`**: `if (*(rbx_3 + 0x7a) != 2)` → packs from **`rax_11`** / **`sub_1404628b0`** / tape-style path **without** that **`sub_1402f9a40`** call — same slot, **non-compose** outbound.
- **`0x1402f75bf`**: `*(rdi_14 + 0x7a) = r8_13.b` on inbound merge into **`rdi_14`** (packet slot); **`r8_13.b = 2`** is prepared @ **`0x1402f90ed`** on the path into that merge.

So “game code” definitely splits **compose (`0x7a==2`) → `sub_1402f9a40`** vs **copy/other builder**. **§E.1a** documents **HLIL order** (**`0x1402f5bfe` before `0x1402f75bf`**), **`NetTock` cadence**, the **`0x1402f5bdb` same-invocation compose** spine, and **§E.1b** debunks **`SendBack`** string xrefs as **serde/particles**.

### E.1) Reply / “reply-chain” subject and slot flag **`+0x7a`**

In **`sub_1402f5840`**, the outbound builder **`sub_1402f9a40`** is invoked only when **`*(packet_slot + 0x7a) == 2`** (HLIL @ `0x1402f5bfe` → call @ `0x1402f5c26`). Other values take the branch that copies from **`rax_11`** instead (same function, @ `0x1402f5cc1`).

After inbound handling, the receive path writes **`*(slot + 0x7a) = r8_13.b`** with **`r8_13.b = 2`** on the merge into that block (HLIL @ **`0x1402f75bf`**). **HLIL order** puts **`0x1402f5bfe` before** this merge on the **`0x1402f965f`** spine, so **`sub_1402f9a40` does not read that `= 2` on the same inner-loop iteration** as the merge write. A **later** **`0x1402f5bfe`** (often **same `sub_1402f5840`**, next **`rdi_43`**, if the slot pointer repeats and **`0x7a` is still `2`**—or after **PING/PONG** paths that may rewrite **`0x7a`** to **`1`** @ **`0x1402f78a5`**) decides the actual composer. **§E.1a** documents **`NetTock` cadence**; **§E.1a** “CFG” documents the **infection `0x1402f5bdb`** case where **same-invocation compose is explicit in HLIL**.

**Other `+0x7a` writers in the same function (HLIL anchors):**

| Value | Site | Notes |
|------:|------|--------|
| **2** | `0x1402f5bdb` | After **`sub_1400af880`** @ **`0x1402f8bce`** and the **`jump_table_1402f9a18`** dispatch @ **`0x1402f8c0d`**: writes **`*(rbx_30 + 0x7a) = 2`** when not already **`2`**. HLIL then runs the **`+0x98`** **`do while`** @ **`0x1402f5bef`**, sets **`rdi_43 = rbp_3`**, and **re-enters `while (true)` @ `0x1402f965f`** — so **`sub_1402f9a40` can run later in the *same* `sub_1402f5840`** on a **later `rdi_43`** pass if **`rbx_3` still points at that slot** (**§E.1a**). |
| **1** | `0x1402f78a5` | **PING → PONG** staging: fills the slot buffer, then sets **`0x7a = 1`** when the slot was not already **`2`** (see `if (*(var_3a8_1 + 0x7a) != 2)` immediately before). |
| **0** | `0x1402f85f3` | **“LAW ENFORCEMENT OPERATION”** / spam-template branch: clears **`0x7a`** after populating the slot for that outbound. |
| **propagated** | `0x1402f65ac` | **`*(slot + 0x7a) = *(slot + 0x3a)`** (HLIL: **`rbx_5 = *(rbx_3 + 0x3a)`** @ **`0x1402f5f3f`**, then stored @ **`0x1402f65ac`**). There is a guard **`if (rbx_5 != 2)`** @ **`0x1402f5f46`** earlier on the same slot pointer. |

So **`0x7a`** is both a **mode enum** (at least **0 / 1 / 2** observed) and, in one branch, a **copy of another slot byte at `+0x3a`**. **`+0x3a`** is the next place to xref when modeling reply / infection state without guessing.

### E.1a) NetTock cadence, `0x98` slot list, deferred compose, and “next tick” behavior

This subsection summarizes **`get_xrefs_to(0x1402f5840)`** + **`decompile_function sub_14026cc80`** + **`get_il sub_1402f5840` (HLIL)** so the **mechanism** for future emissions is explicit.

**Who runs `sub_1402f5840`, and how often**

- **Direct code xrefs** (MCP): **`sub_14026cc80`** @ **`0x14026d2d2`**, **`sub_140276b60`** @ **`0x140276dc0`**, **`sub_14058d950`** @ **`0x14058dbb0`**, **`sub_1405b8160`** @ **`0x1405b87bc`** — all Bevy-style system glue (panic blobs in the same neighborhood name **`Events<NetTockEvent>`**, **`NetNode`**, etc.).
- **`sub_14026cc80`** (representative): loads **`rbp = *(arg2 + 0x270)`**, then **`*(arg2 + 0x270) += 1`** (world / schedule counter), eventually calls **`sub_1402f5840`**, then stores **`*(arg1 + 0x598) = rbp`**. So **`sub_1402f5840` is one net pass per scheduled system invocation**, not a tight inner callback loop by itself.

**What the big driver walks (HLIL skeleton)**

- **Outer step:** **`while (r12_1 != rax_8)`** @ **`0x1402f94fc`** — advances the **entity / endpoint queue** (`r12_1` steps; **`continue`** when **`r13_1 == 0`** @ **`0x1402f94ee`** / **`0x1402f95f2`**).
- **Inner send index:** **`while (true)`** @ **`0x1402f965f`** with **`rdi_43`** — each iteration reaches the outbound gate **`if (*(rbx_3 + 0x7a) == 2)`** @ **`0x1402f5bfe`** early (**`rbx_3`** is the **`0x98`-strided packet blob** for the active row: **`var_e8_1 = rcx_9 * 0x98 + rbx_3`** @ **`0x1402f5bbf`**, **`result_2 = var_120_1 + rdi_43 * 5`** @ **`0x1402f5b8d`**).
- **Secondary slots on the same endpoint:** **`rbx_30 = var_3a8_1`**, **`rbx_3 = rbx_30 + 0x98`**, **`do while (rbx_3 != var_e8_1)`** @ **`0x1402f5bef`–`0x1402f5be0`** — walks **more packet-slot structs** at **`+0x98`** strides (same function, infection / template tail). So one **NetNode** can own **multiple** **`0x98`** packet records; each has its **own** **`+0x7a`**.

**How `+0x7a` drives the *next* emission**

- **`+0x7a` lives in the slot struct in RAM** until another writer overwrites it (**§E.1** table).
- The **only** full composer is **`sub_1402f9a40`**, gated by **`*(slot + 0x7a) == 2`** @ **`0x1402f5bfe`**. Whatever **`+0x7a`** is **when that `if` runs** picks **compose vs copy / tape** for that evaluation.

**HLIL ordering on the `0x1402f965f` spine (merge path `0x1402f75bf`)**

- **`0x1402f5bfe`** (**read `+0x7a` → maybe `sub_1402f9a40`**) appears **before** the merge tail **`0x1402f75bf`** (**`*(rdi_14 + 0x7a) = r8_13.b`**, with **`r8_13.b = 2`** from **`0x1402f90ed`** on the **`label_1402f90e8`** path).
- So **on the same `rdi_43` inner-loop iteration**, **`sub_1402f9a40` cannot be triggered by the `= 2` just written at `0x1402f75bf`** — the **next** **`0x1402f5bfe`** is at least the **next time** control reaches that site (**often** after **`rdi_43`** advances to **`rbp_3`** @ **`0x1402f5b6a`**, still inside **`sub_1402f5840`**, if the same **`rbx_3` / `var_3a8_1`** is reused and **`0x7a` stayed `2`**; or a **later `NetTock`** if the slot is rewritten first, e.g. **`0x1402f78a5`** (**`0x7a = 1`**) on PING→PONG staging).

**CFG: infection / jump-table path (`0x1402f5bdb`) — same-invocation `sub_1402f9a40` is possible**

- From **`label_1402f88e7`** through **`sub_1400af880`** @ **`0x1402f8bce`**, HLIL hits **`*(rbx_30 + 0x7a) = 2`** @ **`0x1402f5bdb`** (same VA as the table row in **§E.1**), then executes the large template / **`arg12`** writer, then **`rbx_30 = var_3a8_1`**, **`rbx_3 = rbx_30 + 0x98`**, **`do while (rbx_3 != var_e8_1)`** @ **`0x1402f5bef`**, then **`if (rbp_3 == r13_1) break`**, else **`rdi_43 = rbp_3`** @ **`0x1402f5b6a`** and **falls through to `while (true)` @ `0x1402f965f`** (**`get_il sub_1402f5840`**, lines **`0x1402f8bce`–`0x1402f9700`** region).
- Therefore **`0x7a` is armed to `2` and then a *new* inner-loop iteration can reach `0x1402f5bfe` with `==2`** without leaving **`sub_1402f5840`** — **not** deferred to the next **`NetTock`** for that branch class.

**Wire-level “bounce wrong destination”**

- Still **not** located in **`sub_1402f5840`** by name. **`sub_14079a770`** @ **`0x1402f7cb1`** remains a **credit / strip** helper in the subject-line tail, not a proven reflect-to-sender routine (**§E.1a** legacy note). **§E.1b** explains why **`SendBack`** / **`PacketDrop`** **`.rdata`** hits are **misleading** for net parity.

### E.1b) `SendBack` / `PacketDrop` **`.rdata`** hits (MCP `get_xrefs_to`) — serde & particles, not the relay

**`get_xrefs_to(0x142473c18)`** (“`variant identifierSendBackPacketDropPacket`”):

| Function | Site | Role |
|----------|------|------|
| **`sub_1404d9170`** | **`0x1404d9173`** | **`Display` / `Debug` tailcall** into **`sub_1423afb20`** with that static string — **Rust formatting**, not gameplay dispatch. |

**`get_xrefs_to(0x142473c88)`** (“`DropInboundDropOutboundSendBackOutbound`” …):

| Function | Site | Role |
|----------|------|------|
| **`sub_1403698e0`** | **`0x14036999a`** | **`serde_json`** enum serialization: **`sub_14032b9a0`** compares against **`"DropInbound…"` / `"SendBackOutbound"` / `"DropOutbound…"`** byte slices when writing JSON. |
| **`sub_14054cbc0`** | **`0x14054cbed`** | Same pattern: **JSON variant tagging** for a small discriminant in **`arg1`**. |
| **`sub_14047e340`** | **`0x14047e4fe`** etc. | **Parser**: walks bytes in **`arg2`**, compares windows to **`"SendBackOutbound"`** / **`"DropOutbound…"`** / **`"DropInbound…"`**, sets **`arg1[1]`** to **`0 / 1 / 2`**. Callers include **`sub_14054c8f0`** @ **`0x14054c990`**, **`0x14054c9ae`** — **particle / UI JSON**, not **`sub_1402f5840`**. |

**Conclusion:** those strings label **serde + particle packet-kind JSON**, **not** the in-world **wrong-address bounce** implementation. Finding **real bounce** still means tracing **relay / address filter** code (e.g. **`sub_14044eae0`**, **`sub_1400af880`** families) **without** relying on these xrefs.

### E.2) Five-byte `result_2` row (pointer into stride-5 table)

In **`sub_1402f5840`**, the pointer passed as **`arg3`** to **`sub_1402f9a40`** is:

- **`result_2 = var_120_1 + rdi_43 * 5`** @ **`0x1402f5b8d`**, with **`rdi_43`** the per-endpoint send index in the inner loop.

**`var_120_1`** is loaded from a **`0x58`-byte strided table** (same family as other Bevy component rows in this function):

- **`var_120_1 = *(*(r8_52 + 8) + *(rcx_297 + result + 8) * 0x58 + 0x40)`** @ **`0x1402f961a`**.

So the **base of the 5-byte rows** is a **pointer at field `+0x40`** of the row selected by **`*(rcx_297 + result + 8)`** (entity/context index into **`rcx_297`**). Populating that **`+0x40`** field is the right anchor for replacing **`encodeEndpointAddressForStrategy`** heuristics with binary-accurate tuples (spawn / map / asset systems, not **`sub_142244e00`**’s **`var_308`** fill).

**Mechanical writer of `0x58` rows:** **`sub_140516d40`** (`0x140516d40`) grows the same table shape: for index **`rdx`** it stores **`arg2[0..3]`** into **`+0x00..+0x30`**, **`arg2[4]`** into **`+0x40`**, and a length/cursor field into **`+0x50`**. **`get_xrefs_to(0x140516d40)`** (MCP) includes **`sub_1402f5840`** (two call sites), **`sub_14044eae0`**, **`sub_1403a7a00`**, **`sub_1404f0910`**, **`sub_1404f3a90`**, **`sub_14074aa00`**. So **`+0x40`** is filled whenever those paths pass the packed **`arg2`** blob—often alongside **`sub_140516d40(&…, &var_228)`**-style locals built from a live packet slot.

### E.3) Staging halfword **`+0x3a` / `+0x3b`** (`sub_14044eae0`)

The large relay **`sub_14044eae0`** (`0x14044eae0`, callers **`sub_140444950`**, **`sub_140584790`**, **`sub_1405e5170`**) walks the same **`0x60`** NetNode rows and **`0x58`** side tables as **`sub_1402f5840`**. On several paths it **skips work when `*(packet_slot + 0x3a) == 2`** (HLIL **`continue`** right after the test, e.g. @ **`0x14044efa4`**, **`0x14044f179`**, **`0x14044f39e`**).

HLIL often loads **`int16_t` at `slot + 0x3a`** (e.g. **`0x14044f0a3`**, **`0x14044f6c3`**) into locals that become part of the **`var_228`** bundle passed to **`sub_140516d40`**. **`+0x3b`** appears as a separate byte in the same flows (**`*(slot + 0x3b)`** @ **`0x14044fa14`** and packed into **`var_1ee:1`** @ **`0x14044fd60`**).

Concrete staging literals in the same function:

- **PING** inject: **`var_1ee = 0`** @ **`0x14044f8fc`** (with **`var_1ec_3 = 0`**) before writing the outbound slice at **`slot + 8`**.
- **PONG** inject: **`var_1ee = 1`** @ **`0x1404500e1`** before the same style of slot write.

Together with **`§E.1`**, this supports treating **low `+0x3a`** values **0 / 1 / 2** as the same **staging / compose** family as **`+0x7a`**, with **`+0x7a := +0x3a`** on the **`0x1402f65ac`** path.

### E.4) Who calls **`sub_14044eae0`** (Rust names from panic metadata)

Three direct callers are visible in BN:

| Function | Call site | Role |
|----------|-----------|------|
| **`sub_140444950`** | **`0x140444b73`** | Bevy system glue: resolves world resources with **`sub_14225f810`**, reads **`*(table + 0x10)`** / **`*(table + 0x40)`** pairs (same shape as the **`0x58`** row metadata elsewhere), then **`sub_14044eae0`**. On failure, panic blobs name **`Events<NetTockEvent>`** with **`Fragile`** sign, and **`tunnet::net::relay::Relay`** alongside **`tunnet::story::Story`**, **`setup_doors`**, **`QueryState<(Entity, &NetNode, …)`**. |
| **`sub_1405e5170`** | **`0x1405e53a6`** | Same control flow as **`sub_140444950`** (increment **`*(world + 0x270)`**, same resource lookups, same **`sub_14044eae0`** argument layout); different static descriptor pointer in the panic path. |
| **`sub_140584790`** | **`0x14058489a`** | Thin wrapper: packs stack locals and **`return sub_14044eae0(...)`** (no extra logic in the decompile snippet). |

So the **relay / PING-PONG / `0x3a` gate** logic is not an orphan—it sits under **`tunnet::net::relay::Relay`**-flavored schedules and the same **`NetTockEvent`** family as the main tick driver.

### E.5) Graph routing **`sub_1403a7a00`** (propagating **`+0x40`**)

**`sub_1403a7a00`** is a large **NetNode walk + 3D distance / path** system (**`sub_1400b0930`**, **`sub_14037cea0`**, **`sub_140764ba0`** over a **`0x58`-strided open-addressed table** whose SIMD probe base is **`&data_142429eb0`** (**`var_160_1`**, HLIL **`neg.q(…) * 0x58`** steps @ **`0x1403a8a05`** / **`0x1403a80b5`**). Do **not** confuse this with **`sub_14037e9d0 → sub_1406425d0`** (**`0xc`** inline cells — **§E.12**). It:

- Loads **`rbp_25 = *(rdx_27 + rbp_24 + 0x40)`** @ **`0x1403a88e4`** — the **existing neighbor row’s `+0x40` pointer** (same field **`sub_1402f5840`** later dereferences for **`result_2`**).
- Matches candidate rows (**`r13_9`**) and calls **`sub_140516d40(&var_a0, &var_298)`** @ **`0x1403a8e7d`**, where **`var_298`** is filled from the **matched `0x58` slot** (headers, **`+0x3a`**, **`+0x3b`**, etc.).

So at least on this path, **`+0x40`** is not minted from thin air: it is **copied forward from table data already attached to other nodes / candidates** when the graph search commits a row.

### E.6) Remaining **`sub_140516d40`** callers (full xref list)

**`sub_1404f0910`** (`0x1404f0910`, call @ **`0x1404f0b1b`**)

- Same **`0x60` / `0x58`** walk as the scheduler.
- **`rbp_1 = *(*(node + 8) + index * 0x58 + 0x40)`** @ **`0x1404f0a59`** — reuses the **existing** five-byte table pointer.
- **`r14 = *(netnode + 0x58)`** drives a loop; each iteration builds a **“Dummy packet”** string (**`strncpy` @ `0x1404f0aa9`**), a **static** header blob (**`"ffaeb6"`** @ **`0x1404f0ae3`**, small **`memcpy`**), then **`sub_140516d40(&var_78, &var_128)`**.
- Looks like **test / injector traffic** (same world shape as **`tunnet::net::tester::SendButton`** query chunks seen near other net systems). It **does not** show allocation of a brand-new **`+0x40`** target—only **appends `0x58` rows** using a **stack template**.

**`sub_1404f3a90`** (`0x1404f3a90`, multiple **`sub_140516d40`** sites e.g. **`0x1404f4513`**, **`0x1404f48ef`**, **`0x1404f4a13`**, **`0x1404f4d3d`**)

- Another **multi-endpoint** walker with **`*(slot + 0x3a) != 2`** gates and **`*(slot + 0x7a)`** handling like **`sub_1402f5840`** / **`sub_14044eae0`**.
- **`r8_1`**, **`rdi_5`**, **`rdx_6`** are loaded from **three** **`*(… * 0x58 + 0x40)`** slots @ **`0x1404f3e4b`**, **`0x1404f3e50`**, **`0x1404f3e5b`** — always **existing** table pointers.
- **`sub_14079fa10`** + manual stores **`0x1404f4b36`–`0x1404f4b81`** mirror **`sub_140516d40`’s** **`0x58`** write pattern (**`+0x40` ← `var_278`**, packed from the **per-connection block** at **`rcx_11`** inside a sibling’s heap buffer). This is a **connection commit / copy** path, not first-time worldgen.

**`sub_14074aa00`** (`0x14074aa00`, **`sub_140516d40`** @ **`0x14074b501`**)

- Very large Bevy-style system (many query parameters); touches **`0x1cf`** flags, **`sub_1400ae2a0`**, **`0x98`**-strided packet slots, **`*(slot + 0x7a)`**, and the usual **`0x60` / `0x58`** NetNode tables.
- **`sub_140516d40(&var_7c0, &var_7a8)`** feeds **`var_7a8`** from **`r15_5`** packet/relay state.
- **Side buffer** (HLIL **`var_b70_1`**, rows spaced by **`0x68`**) gets **`*(row + 0x40) = …`** @ **`0x14074b60f`** — a **packed 64-bit** built from SIMD lanes (decompiler artifact around pointer-sized data).
- **Direct slot writes:** **`*(slot + 0x40) = rbx_29`**, **`*(slot + 0x48) = r8_25`** @ **`0x14074ca69`–`0x14074ca6e`** (`rbx_29` / `r8_25` from **`var_7a8`**).
- **Closest “bootstrap” pattern so far:** **`rbx_30 = *(0x58_row + 0x40)`** @ **`0x14074cc5f`**, then a loop @ **`0x14074cc73`–`0x14074cc84`** **zeroes** **`rbx_30 + i * 0x20 + {0x10,0x18}`** for **`i in 0 .. *(netnode+0x58)`** — clears destination-side memory **through** the pointer already stored at **`+0x40`**, i.e. **prepares** the buffer the scheduler later reads as **`result_2`**. The instruction that **first assigned** that pointer is **not pinned** in the snippets above; **`sub_140292f00`** / **`sub_14079f290`** in the same function only handle **contiguous buffer growth**—the original **`+0x40`** store likely occurs earlier in this system or in **build/spawn** code still to be found.

### E.7) **`sub_14074aa00`** — who registers it (pathfinding / nav)

**`get_xrefs_to(0x14074aa00)`** yields three code refs:

| Caller | Call site | Notes |
|--------|-----------|--------|
| **`sub_14058e470`** | **`0x14058e726`** | Argument packer only; forwards many query handles into **`sub_14074aa00`**. |
| **`sub_1405be400`** | **`0x1405bea00`** | Full Bevy **`sub_14225f810`** resource resolution; panic metadata includes **`tunnet::net::transport::Handles`**, **`tunnet::map::setup`**, **`tunnet::hud::nav`**, and **`QueryState<(Entity, &mut Transform, &mut tunnet::npc::path_finding::PathFinding`, …** — same broad family as **`§E.5`** graph work but wired as a **scheduled system** over **net handles**. |
| **`sub_14073eeb0`** | **`0x14073f496`** | Parallel layout (larger **`arg1`** offsets); same **`Handles` / `map::setup` / `PathFinding`** string chunk on the failure path that reaches **`sub_14074aa00`**. |

So **`sub_14074aa00`** is not the main **`NetTock`** emitter; it is **pathfinding + transport handle maintenance** that also **clears / repacks** slot memory tied to **`+0x40`** (**`§E.6`**).

### E.8) **`sub_1404f3a90`** — extra callers

**`get_xrefs_to(0x1404f3a90)`**:

| Caller | Call site | Notes |
|--------|-----------|--------|
| **`sub_1404d4100`** | **`0x1404d43a4`** | Bevy glue (increment **`*(world+0x270)`**, **`sub_14225f810`** lookups). Failure strings include **`Compass`**, **`Credits`**, **`SendButton`**, etc.—success path calls **`sub_1404f3a90`** with packed **`NetNode`** query state. |
| **`sub_1405849d0`** | **`0x140584ae4`** | Thin **`return sub_1404f3a90(...)`** wrapper (same pattern as **`sub_140584790`** → **`sub_14044eae0`**). |
| **`sub_1405e7bb0`** | **`0x1405e7e65`** | **Twin of `sub_1404d4100`**: same **`arg1+0x120` / `rbx+8` / `0x1b0..0x1c8`** resource walk, same **`sub_1404f3a90`** argument packing, same **`*(arg1+0x298)`** tick counter write—only the static panic descriptor pointer differs (**`data_1424741f0`** vs **`data_14243dd28`** on some branches). Second **Bevy schedule strip** for the same net-slot logic. |

The same **`update_preview_connections`** subsystem is now tied to **`sub_1401597f0` → `sub_140175c50`** (see **§E.11**). The **`.rdata`** substring @ **`0x142453b81`** still yields **empty** MCP **`get_xrefs_to`** on the string VA—navigate via those functions instead. **`get_xrefs_to(0x1404d4100)`** may also return **no code refs** (vtable / registration path); use **`sub_1404d4100`** / **`sub_1405e7bb0`** as **direct navigation** targets.

**`DeferredConnection` / `NewNode` / `remove_new_nodes`** appear only in **`.rdata` blobs** in this session (e.g. string hits @ **`0x14243fd81`**, **`0x142440881`**); **`get_xrefs_to`** on those VAs returns **empty** in MCP—use BN’s **Data** view. Resolving them to a **`sub_140516d40`** or **`+0x40`** writer still needs UI xrefs or a **`mov`** scan on **`.text`** for **`0x58`**-row stores.

### E.9) Helpers around **`sub_14074aa00`** (int queue + schedule preludes)

**`sub_140292f00`** (`0x140292f00`)

- Small **`i32`** buffer helper: **`sub_1407a03f0`** then **`memmove` / `memcpy`** with **`<< 2`** (element size **4**).
- **`get_xrefs_to`**: **`sub_140293600`** @ **`0x14029361a`**, **`sub_14074aa00`** @ **`0x14074ccc1`**.
- In **`sub_14074aa00`**, it runs when **`rax_4[3] == *rax_4`** (length == capacity) **before** appending another **`i32`**; after it runs, the code stores into **`rax_4[1]`** and bumps **`rax_4[3]`**, and when **`rax_4[3] + 1 >= 0x21`** it **rolls the base index** **`rax_4[2]`** and clears **`rax_4[5]`**—a **fixed-capacity (~0x20 slot) ring / dequeue** of **`u32`** used alongside **`sub_14079f290`** growth for pointer side tables @ **`0x14074cd47`–`0x14074cd8f`**. It is **not** an allocator for **`+0x40`** five-byte row bases.

**`sub_14055dfe0`** (`0x14055dfe0`) — prelude on **`sub_1405e7bb0`**

- When **`*(arg1+0x2a0)`** and schedule counters match **`arg2`**, loops **`0x138`**-byte steps, calls **`sub_1400a9240(arg1+0x40, …)`** to copy component chunks from the world, **`sub_142286e00`** on **`arg1+0x250` / `+0x270`**, etc. **ECS system-parameter refresh** before the user system body runs.

**`sub_14055e8a0`** (`0x14055e8a0`) — prelude on **`sub_1405be400`**

- Same idea with **different `arg1` offsets** (**`0xda`..`0xdc`**, **`sub_1400a01a0`**, **`sub_1400913f0`**, **`sub_140090480`**, **`sub_14008ec40`**, …)—**another system struct layout**, same **`0x138`** stride and **`sub_142286e00`** string moves.

Inside **`sub_1402f9a40`**, when **`r13.d == 2`** (first dword of the **`arg3`** row) and **`(b,c,d) == (4,2,1)`** (`rcx_1.b`, `r12.b`, **`var_a0.b`** checks @ `0x1402f9d58`), the packet subject is **`__builtin_strncpy(..., "Re: Re: Re: Re: ...", 0x13)`** @ **`0x1402f9d8f`**, with **`*(arg1 + 0x28) = 0x13`**. The same literal appears in `.rdata` inside **`data_1424246e0`** (BN string filter **`Re: Re:`**). No **`sub_140673b40`** pool is used for that subject.

### E.10) **`0x58` table growth: `sub_14079fa10`** vs append helpers **`sub_140516d40` / `sub_140516f40`**

**`sub_14079fa10`** is a **generic Rust `Vec`-style reserve** for arrays whose elements are **`0x58` bytes** wide: HLIL scales the old length by **`0x58`**, calls **`sub_14079e410`** with **`new_capacity * 0x58`**, and updates the usual triple (**ptr / len / cap**). It does **not** choose **`+0x40`** tuple bases; it only **reallocates backing storage** when something else has already decided how many **`0x58`** rows exist.

**`get_xrefs_to(0x14079fa10)`** is large; notable **net-adjacent** callees include **`sub_140516d40`** (**`0x140516da2`**, **`0x140516e36`**), **`sub_140516f40`** (**`0x140516f75`**, **`0x140516f95`**), **`sub_1404f3a90`**, the **`sub_1402f0840` / `sub_1402f0e70` / …** family next to **`sub_1402f5840`**, and **`sub_140380650`** (many sites). Treat it as **shared grow plumbing** for **`0x58`-strided** tables, not as the **first** writer of **`*(row+0x40)`**.

**`sub_140516d40`** and **`sub_140516f40`** are **the same algorithm class**: HLIL for **`sub_140516d40`** already branches on **`*(arg1[2] + 0x48)`** and calls **`sub_14079fa10`** on either **`arg1[2]+0x18`** or **`arg1[2]+0x30`** before writing the **`0x58`** row (**`+0x40` ← packed `arg2[4]`**). **`sub_140516f40`** repeats that **dual-`Vec`** choice with only **field-store ordering** differences. **`get_xrefs_to(0x140516f40)`** returns **only** **`sub_140380650`** (many internal call sites). **`get_xrefs_to(0x140380650)`** returns **only** **`sub_140175c50`** @ **`0x14017664f`**. The related **`sub_140386c30`** helper is called from **`sub_140175c50`** @ **`0x140176bd6`** **and** from the twin walker **`sub_14016d910`** @ **`0x14016f587`** (§E.11). So **`sub_140516d40`** covers **NetTock / relay / graph / pathfinding** (§E.5–E.6), while **`sub_140516f40`** is **specialized codegen** for **`sub_140380650`** inside **`sub_140175c50`** only.

### E.11) **`update_preview_connections`** — `sub_1401597f0` / **`sub_140175c50`** / **`data_142429eb0`**

**Rust string (BN `list_strings_filter`)**: **`tunnet::net::build::update_preview_connections`** @ **`0x142453b81`** (embedded in a longer **`NetNode` / `BuildingSurface`** query blob). MCP **`get_xrefs_to`** on that VA is **empty**; treat **`0x142453b81`** as a **label** and use code symbols below.

**Bevy registration / body (two near-parallel systems)**

- **`sub_1401597f0`** (`0x1401597f0`): failure strings include **`bevy_ecs::event::Events<tunnet::net::build::BuildNodeEvent>`**, **`QueryState<… &mut tunnet::net::transport::NetNode>`**, **`chunk::LoadedChunk`**, **`tunnet::npc::Handles`**, etc. It calls **`sub_140175c50`** @ **`0x140159b05`** with packed world queries (**`arg1+0xe8`** / **`0x1b8`** layout branch).
- **`sub_140156d80`** (`0x140156d80`): **same `BuildNodeEvent` + `NetNode` query** panic blobs, but **`arg1+0xd0`** / **`rsi+0x420`** offsets and a different static descriptor (**`data_142409b78`** vs **`data_14243dd28`** on some paths). It calls **`sub_14016d910`** @ **`0x140157178`** — a **second mega-walker** in the same **build-preview** family as **`sub_140175c50`**.
- **`get_xrefs_to(0x140175c50)`**: **`sub_1401597f0`** @ **`0x140159b05`**, **`sub_140588270`** @ **`0x1405883ed`**, **`sub_1405ebbe0`** @ **`0x1405ebf0a`**.
- **`get_xrefs_to(0x14016d910)`**: **`sub_140156d80`** @ **`0x140157178`**, **`sub_14058b220`** @ **`0x14058b461`**, **`sub_1405c8230`** @ **`0x1405c8642`** — same **schedule-twin** idea as **`175c50`**.

**What **`sub_140175c50`** does (selected HLIL anchors)**

- Iterates **`NetNode`**-style tables (**`0x60`** stride on **`*(world + 0xd0)`**, **`0x58`** child counts, **`unwrap`** panics on **`Option`**).
- **Reads existing **`+0x40`** pointers** from **`0x58`** rows when walking neighbors, e.g. **`0x140175ec1`**, **`0x140176278`**, **`0x140176ee8`** — preview logic **reuses** graph storage already attached to nodes; it does not invent **`+0x40`** from **`sub_142353b40`**.
- **`sub_140380650`** @ **`0x14017664f`**: large **`0x8000`**-buffer **`memcpy`** / command recording; inner **`sub_140516f40`** sites maintain the preview **`0x58`** table (**`get_xrefs_to(0x140380650)`** is **only** **`sub_140175c50`**).
- **`sub_140386c30`** @ **`0x140176bd6`** (**`sub_140175c50`**) and @ **`0x14016f587`** (**`sub_14016d910`**): **shared** alternate command-builder path (same **build** subsystem, two walkers).
- **`sub_14037e9d0`**: **open-addressed find/insert** (**`sub_140765b70`** hash, **`sub_1406425d0`** on miss — see **§E.12**). Called from **`sub_140175c50`** @ **`0x140176139`** with **`&data_142429eb0`** wired into the stack **`arg1`** bundle @ **`0x14017602f`**. That is **not** the same layout as **`sub_1403a7a00`’s** **`0x58`**-wide path cells (**§E.5** / **§E.12**): both reuse the **`data_142429eb0`** label as a **static anchor**, but **`37e9d0 → 6425d0`** stores **`0xc`**-byte **inline** payloads, not **`sub_140516d40`** row **`+0x40`** pointers.

**`sub_142353b40` — not a five-byte-row allocator**

- Decompile shows **`TlsGetValue` / `TlsSetValue`**, a **`0x20`**-byte TLS object, and **`BCryptGenRandom`**. It returns **`&tls_block[1]`** (two **`u64`** words of RNG state).
- **`sub_140175c50`** @ **`0x140175fb3`** uses **`sub_142353b40(nullptr)`**, then **`zmm0_1 = *rax; *rax += 1`** — **consumes thread-local randomness** for hashing/probing, **not** as the heap pointer stored at **`*(0x58_row + 0x40)`** for **`sub_1402f5840`’s `result_2`**.

**Still open:** the **first** heap store of **`*(row+0x40)`** for a **brand-new** runtime **`NetNode`** remains elsewhere (**`sub_14074aa00`**-class slot repack, **spawn / component insert**, or another builder — **not** **`sub_1406425d0`**); **`sub_140175c50`** mostly **propagates** existing **`+0x40`** and appends via **`sub_140516f40`**.

### E.12) **`sub_1406425d0` / `sub_14062eb10`** — **`0xc`** inline map (not **`+0x40`** / not **`0x58`** rows)

**`sub_1406425d0`** (`0x1406425d0`)

- Scans the **16-byte occupancy bitmap** at **`arg1[3]`** (SIMD **`_mm_movemask_epi8`**) to find a free **tombstone / empty** byte, then writes the **high-byte** of the **hash** (**`(arg2 >> 0x39).b`**) into the **paired** mirror slots @ **`0x14064266f` / `0x140642673`** (Robin-Hood / secondary-index pattern).
- Stores the caller’s **`arg3`** payload as **two little-endian words** @ **`0x140642691` / `0x140642698`** — offset math uses **`neg.q(rdx_2) * 3`** with **`<< 2`**, i.e. **12 bytes per logical value** adjacent to the control bytes.
- When the table is full, calls **`sub_14062eb10(arg1, arg4)`** @ **`0x1406426b1`** before retrying.

**`sub_14062eb10`** (`0x14062eb10`)

- **Load-factor / growth**: if **`arg1[2]`** (live count) exceeds about half the **mask** **`arg1[0]`**, allocates a **new** **`(capacity * 0xc + …)`** byte buffer (**`mulu …, 0xc`** @ **`0x14062ef1d`**), **`memset(0xff)`** the bitmap tail, **reinserts** every live **`0xc`** cell (**loop @ `0x14062f039`–`0x14062f02e`**), and swaps **`arg1[3]`** to the new storage (**`0x14062f0ed`**).

**`get_xrefs_to(0x1406425d0)`**

- **`sub_14037e9d0`** @ **`0x14037eade`** (the **`175c50`** / **`16d910`** **`37e9d0`** insert path).
- **Nine** immediate sites inside **`sub_14016d910`** (**`0x14016e64c`** … **`0x14016e7ec`**) — build-preview **coordinate / key** churn, **independent** of **`sub_140516d40`**.

**Contrast with `sub_1403a7a00`:** HLIL there steps **`neg.q(…) * 0x58`** (**`0x1403a8a05`**, **`0x1403a80b5`**) over **`var_160_1 → &data_142429eb0`**, i.e. **path-cache records** sized like **`sub_140516d40`** **`0x58`** rows. That is a **different** open-addressing implementation than **`6425d0`’s** **`0xc`** map, even though both stack bundles mention **`&data_142429eb0`**.

### F) Confirmed `0x1c4` phase advancement points

Within `sub_1402f5840`, the following state transitions are directly visible:

- `0x1c4: 5 -> 6` after the status-family send path (same branch that enqueues event `0x0f`)
- `0x1c4: 6 -> 7` in the follow-up branch when normalized route tuple has `c < 2` (normalization treats octet `0` and `2` as `1` before compare)

These two transitions are now safe to model as binary-backed behavior.

### G) Confirmed read semantics for `0x1c5` (mainframe phase index)

In `sub_1402f9a40`, the decompiler shows `uint64_t rax_37 = zx.q(*(arg2 + 0x1c5))` immediately before a `switch (rax_37)` with cases `0` through `5` for the `a == 4` / `(1,1,1)` tuple path. Each case sets the corresponding `0x1020104`-style header table and optional side buffers (for example case `2` uses `sub_14067a670` with `&data_1424246e0[0x30]`).

So for that branch, **`0x1c5` is the mainframe sub-phase index** (not a tick gate). The TypeScript model field `phaseB` in `src/recovered-endpoint-scheduler.ts` is intended to mirror this byte/word at `+0x1c5` for parity with the `a === 4` profile.

**Writes to `0x1c5`:** The scheduler pair **`sub_1402f5840` / `sub_1402f9a40`** only **read** `+0x1c5` (`movzx`; confirmed in saved disassembly). Advancement is **not** there.

**Primary writer (found): `sub_1401f5660`** — large Bevy-style system; `r14` is the same endpoint-style blob pointer (`arg4[2]`). It implements an explicit **state machine** on `*(r14 + 0x1c5)`:

- `switch (*(r14 + 0x1c5))` with cases **0–9** advancing **0→1→2→3→4→5→6→7→8→9→0xa** (each case writes the next value and `continue`s).
- Additional writes set **`0xb`** (grep HLIL for `*(r14 + 0x1c5) = 0xb`) and **`6`** when `zx.q(*(r14 + 0x1c5)) - 6 u<= 4` (i.e. current value already in **6..10**), used together with **`'P'` / `'N'`** byte-array edits on `r14[5]` / `r14[6]` (route-string style data).

So the **same byte** at `+0x1c5` spans at least **0..0xb** across the binary, not only **0..5** as exercised by `sub_1402f9a40`’s mainframe header switch.

**Callers of `sub_1401f5660`** (MCP `get_xrefs_to` on `0x1401f5660`): `sub_1401e1b20` @ `0x1401e217c`, `sub_14058d390` @ `0x14058d65f`, `sub_1405ca030` @ `0x1405ca6a6` (likely registration / schedule glue — name in BN UI).

**Callers of `sub_140165cb0`** (`get_xrefs_to` **`0x140165cb0`**): `sub_14015c6f0` @ `0x14015cb8a`, `sub_14058ad70` @ `0x14058af99`, `sub_1405b6360` @ `0x1405b680c`.

**Secondary writer: `sub_140165cb0`** (contains VA **`0x140166850`**). Large Bevy-style system (zone / map graph: strings like **`bunker`**, **`surface`**, **`underwater`**, **`cavesnd/.ogg`**, **`snd/new_zone.ogg`**, **`sub_140673740`** RNG, **`sub_1405211a0`** events). HLIL includes **`if (*(rcx_1 + 0x1c5) != 0xb)`** then **`*(rcx_1 + 0x1c4) = 0xe`** / event **`0x2c`**, and later **`*(rcx_1 + 0x1c5) = 0xb`** at the instruction previously seen as raw **`mov byte [reg+0x1c5], 0x0b`**. Same blob also gets **`0x1c4`** updates (**`0xd`**, **`0xe`**, **`0x13`**, tests for **`0xc`**) in this function — useful for extending **`applyRecoveredStateTransitions`**.

**MCP note:** `function_at` for **`0x140166850`** returns **`sub_140165cb0`** in the bridge payload, but the MCP client schema may **error** (expects a string; server returns structured JSON). Use **`decompile_function("sub_140165cb0")`** directly.

**Discovery method:** scan the mapped `.text` of `tunnet.exe` for **`C6 xx C5 01 00 00`** (`mov byte [reg+disp32], imm8` with disp **0x1c5**), then map hit VA → **`function_at`** / BN **Navigate**.

**Still spot-checked negative** (no `+0x1c5` store in decompile): `sub_140bd6f00`, `sub_140516d40`, `sub_140643f00`, `sub_1400a6cf0`, `sub_140326b90`, `sub_1407759c0`, `sub_14079a770`, `sub_140290120`, `sub_1403ceff0`, `sub_1403a08e0`, `sub_1401cf3e0`, `sub_1404eb580`, `sub_1403b4c60`. Optional MCP `get_xrefs_to_type` may **HTTP timeout**; retry when BN is idle.

### H) Address / endpoint slot resolution (`sub_1400af880`)

`sub_1400af880` is called from the big driver with `(arg4, arg5)` as the **packed address tuple** (see `sub_1402f5840` calling `sub_142244e00` then this). It:

- Validates the tuple against a **bitset** on `arg2` (`*(arg2+0x30)` / `*(arg2+0x38)`).
- Uses `arg3+0x120` as a table of **per-address records**; index path involves `*(arg3+0x128)` as an upper bound and `*(arg3+0xd0)` as the **per-entity `0x60`-stride array** keyed by the resolved slot index, then `*(slot+0x38)` component tables for the active generation counter `*(arg2+0x50)`.

This function is the right anchor for recovering **“which NetNode row matches this address”** (a prerequisite for exact destination lists, before RNG picks among neighbors).

**Code xrefs to `sub_1400af880`** (MCP `get_xrefs_to` on `0x1400af880`):

| Caller | Call site(s) |
|--------|----------------|
| `sub_1401cf3e0` | `0x1401d0fce` |
| `sub_1402f5840` | `0x1402f764b`, `0x1402f7da3`, `0x1402f7de8`, `0x1402f8bce` |
| `sub_1403a08e0` | `0x1403a10dd` |
| `sub_1403b4c60` | `0x1403b55bf` |
| `sub_1404eb580` | `0x1404ec9df`, `0x1404ed536` |

`sub_1403a08e0` decompiles to a **relay / “tape”** style path (`sub_140300e30`, literal `"tape"`, `sub_140642cd0`, `sub_1400b3fd0`) that still uses the same tuple → `sub_142244e00` → `sub_141fcee80` pattern after `sub_1400af880`. **`sub_1401cf3e0`** and **`sub_1404eb580`** full decompiles were scanned for `+0x1c4` / `+0x1c5` HLIL forms; **no hits** for `0x1c5` (writer is **`sub_1401f5660`**, not these).

**`sub_1403b4c60`** (call at `0x1403b55bf`): large Bevy-style system with **world queries**, **`sub_140bd6610`**, **`sub_1400aeb60`**, **`sub_1400ae830`**, **`sub_1400af880`** (second address batch), **`sub_142244e00`** / **`sub_141fcee80`**, strings **`electricsnd/plug.ogg`** / **`snd/plug.ogg`**, and **`sub_140300e30`**. Same **`0x60`** NetNode row walk (`*(r13+0xd0)`, `rcx*0x60`, `+0x38` / `+0x40` generation checks) as the scheduler. Full decompile scan: **no** `+0x1c4` / `+0x1c5` HLIL.

### H.1) What **`sub_1400af880` success/failure** does for **relay / tape** (MCP `decompile_function`)

**Return bundle `arg1` (HLIL `sub_1400af880`):**

- **Success:** **`*arg1 = 0`**, **`*(arg1 + 8)`** filled with the resolved **row / buffer pointer** (the **`sub_142220430`** fast path or the **`arg3+0x120` / `0x60`-stride** walk @ **`0x1400af918`–`0x1400af98e`**).
- **Failure — tuple not in bitset / generation:** **`arg1[1] = 0`**, **`arg1[2] = arg4`**, **`arg1[3] = arg5`** (original coords preserved), **`*arg1 ≠ 0`** (non-zero **`rax_9`** @ **`0x1400af9b1`**).
- **Failure — `sub_142220430` empty:** **`arg1[1] = 1`**, **`*(arg1 + 8) = rcx_3`**, **`*arg1 ≠ 0`** @ **`0x1400af9a6`–`0x1400af9b1`**.

So **“can this address be resolved to a live slot right now?”** is exactly **`*arg1 == 0`** after the call.

**`sub_1403a08e0`** (**tape / graph relay**, call @ **`0x1403a10dd`**): inside the open-hash probe loop over **`&data_142429eb0`**, it calls **`sub_1400af880(&var_1b8, …)`** then **`if (var_1b8.d == 0)`** only then **`sub_142244e00` → `sub_141fcee80`** (enqueue-style path). If **`var_1b8.d != 0`**, it **skips** that **`142244e00` / `141fcee80`** pair for that candidate — **no outbound for unresolved tuple** on that hop. That is **filtering**, not a **`SendBack`** string; it explains **“wrong / unknown address → don’t emit on this relay path”** for **tape**.

**`sub_14044eae0`** (**`tunnet::net::relay::Relay`**, **§E.3–E.4**): HLIL shows **no** call to **`sub_1400af880`**. “Does this packet belong on this port?” is **`sub_1406b6550`** on **`slot + 0x35`** vs staged **`rsi_3[…]`** bytes, **`&slot[3]`**, PING/PONG magic **`0x474e4950` / `0x474e4f50`**, and open-hash **`sub_140766420`** neighbor rows. **`if (sub_1406b6550(...) == 0) continue`**-style paths **skip** relay work when compares fail — again **no delivery on mismatch**, not serde **`SendBack`**.

**Still open for “bounce TTL packet back”:** a path that **builds a return tuple** (swap src/dst, decrement TTL) on purpose. That was **not** found in these **`sub_1400af880` / `sub_14044eae0` / `sub_1403a08e0`** slices; keep searching **`sub_1404eb580`** (also calls **`sub_1400af880`** @ **`0x1404ec9df`**, **`0x1404ed536`**) and **infection / monitor** systems if captures show explicit **reflect** behavior.

### I) Rust type-string anchors (MCP `list_strings_filter`)

Filtered hits include the ECS system name **`tunnet::net::endpoint::update`** inside the usual long Rust metadata blob (example chunk address **`0x142441181`**). Related: **`tunnet::net::endpoint::EndpointPlugin`** near **`0x142461581`**. Use Binary Ninja’s own string/xref UI on these substrings first; **`get_xrefs_to` on the raw chunk address** often returns nothing in this MCP bridge, so treat these as **navigation hints**, not automatic xref sources.

### J) Packet TTL (hop lifetime) — BN research checklist

**Repo context (not game truth):** `src/simulator.ts` implements a **topology scaffold**: if `Packet.ttl === undefined`, **`decrementTtl`** leaves the packet unchanged, so TTL never runs down (“infinite TTL”). When `ttl` is set, filters decrement on the operating port and wrong-address non-sensitive endpoint bounces decrement once; **`README_TS_SIM.md`** summarizes that **design** behavior. **None of this is proven from `tunnet.exe` yet** for the live slot / relay layout.

**Goal:** recover from the binary, for **in-world** packets (slot buffers, **`0x58`** rows, relay forwards — not serde JSON):

1. **Where TTL is set on create** — initial value and which code paths write it (compose vs relay vs inject).
2. **What decrements TTL** — per hop, per device class, or only on specific gates.
3. **What happens at expiry** — drop silently, enqueue an event, bounce with swapped tuple, etc.

**Anchors already in this doc (start here):**

- **`sub_140516d40` / `sub_140516f40`** (**§E.2**, **§E.10**): **`0x58`**-row layout; **`arg2`** packing into **`+0x00..+0x30`**, **`+0x40`**, **`+0x50`**. Check whether any **first-hop** builder stores a **separate hop/TTL byte** next to the five-byte tuple / header blob.
- **`sub_1402f5840`**: after inbound merge / before outbound enqueue, scan **all** **`mov byte|word|dword [slot + disp], …`** on the **`0x98`**-strided packet blob (**§E.1a**). Rename in BN once a field looks like a **small integer** copied into every new outbound.
- **`sub_14044eae0`** (**§E.3–E.4**, **§H**): relay forwarding — does TTL **copy unchanged**, **decrement once per forward**, or **reset**?
- **`sub_1403a08e0`** (tape / graph relay after **`sub_1400af880`**, **§H**): same question when the tuple resolves.
- **`sub_1404eb580`** (**§H** table): calls **`sub_1400af880`**; still a lead for **bounce / TTL** behavior not found in the smaller relay slices.

**Mechanical BN moves (obey §1 one-request-at-a-time):**

1. **`decompile_function("sub_140516d40")`** and **`get_xrefs_to(0x140516d40)`** — pick call sites that build **player-visible** traffic (not only test injectors), follow **stores** into the **`0x58`** row and into **`slot+…`** targets.
2. **`decompile_function("sub_14044eae0")`** — search HLIL for **`add …, -1`**, **`sub …, 1`**, **`dec`** on a **`slot`-relative** address; follow the **fall-through vs branch** when the field hits **0**.
3. **`get_xrefs_to`** on any **candidate field VA** once you have a **data xref** from a **`mov [reg+disp]`** pattern (or scan **`.text`** for **`C6 …`** / **`83 …`** style updates with the same **`disp32`** as your candidate slot offset — same trick as **`+0x1c5`** writers in **§G**).
4. **Do not** use **`SendBack` / `PacketDrop`** **`.rdata`** xrefs as proof of wire TTL expiry (**§E.1b**): those are **serde / particles** labels unless a **non-serde** path is shown copying from them into a live packet.

**When you have a hit, log this (for TypeScript parity):**

| Field | Base pointer | Offset + width | Writers (fn @ VA) | Readers / decrement (fn @ VA) | On zero / underflow |

#### J.1) BN session notes — “how TTL is set” (in progress)

MCP was run against the stock **`tunnet.exe.bndb`** (see **§1** one-request-at-a-time). **Initial TTL on compose** is **not** pinned yet; **relay-side decrement** of a **candidate hop/TTL field** is partially visible.

**Strings (navigation only):**

- **`.rdata`** tutorial lines **`0x14243a630`** / **`0x14243a6f8`**: “Preserves TTL…” / “Decrements TTL…” — **workshop UI copy**, not a code xref target by itself.
- **`0x14248f8c0`**: ASCII **` | ttl: \n`** — looks like a **`Debug` / `Display`** fragment for a Rust packet type. **`get_xrefs_to(0x14248f8c0)`** returned **no code xrefs** in MCP (only a data edge); use BN **Data** view / manual xref from the vtable if needed.

**`sub_140516d40` (`0x140516d40`) — row append:**

- HLIL copies **`arg2`** into a new **`0x58`** row: **`+0x00`…`+0x30`**, **`+0x40 ← arg2[4]`**, **`+0x50 ← *(arg1[2]+0x10)`** (cursor / generation). **Any TTL-like scalar is expected inside the `arg2` bundle** passed in by callers, not invented inside this helper.

**`sub_14044eae0` (`0x14044eae0`, relay) — decrement before enqueue (`sub_140516d40`):**

- **`get_xrefs_to(0x140516d40)`** includes **`sub_14044eae0`** @ **`0x14044f13a`**, **`0x14044fd7f`**, **`0x14044f758`**.
- On the **`label_14044f160`** path, HLIL builds **`var_228`** then calls **`sub_140516d40(&var_b8, &var_228)`**. Immediately before that, it sets **`rdi_27 = rbp_5[1].q`** (second **`qword`** of the live packet slot **`rbp_5`**), then **`if (var_238_1.b != 0) rdi_27 -= 1`**, then folds **`rdi_27`** into **`var_218`**, which is part of **`var_228`**. **``var_238_1.b`** is tied to **`*(rbp_5 + 0x3a)`** on that spine.
- **Working hypothesis:** **`slot[1]`** (second **`qword`**) is a **remaining hop / TTL counter** decremented **once** when relay packs a forward row **under that `+0x3a` condition** — **not** the same as “initial value at create”, but it constrains what the compose path must put in **`slot[1]`** on first send.

**`sub_14037bf80` (`0x14037bf80`)** — neighbor row touch:

- On match, HLIL does **`*(rsi_1 + 0xc) = arg4`** and **`*(rsi_1 + 0x10) = arg6`** (**`rsi_1`** points into a **`0x14`**-strided open-hash value). Relay callers pass **`arg4 = 1`** and **`arg6`** from an incremented counter sourced from **`*(r13_1 + idx*0x38 + 0x30)`** in the same function — **may be path bookkeeping**, not the same field as **`slot[1]`** above; keep separate until one dataflow graph merges them.

**Next BN steps (initial TTL):**

1. **`decompile_function("sub_1402f5840")`** and scroll HLIL around **`0x1402f66ea`** / **`0x1402f6808`** (the other **`sub_140516d40`** sites) — find **first** stores into the **`qword`** that later becomes **`rbp_5[1]`** on the relay slot.
2. **`decompile_function("sub_1402f9a40")`** — slot / buffer fill after **`sub_1402f9a40`** returns into **`sub_1402f5840`**; look for a **constant** or **loaded config** written into the same offset as **`slot[1]`**.
3. Optional: **`get_xrefs_to`** on the **`Debug` vtable`** that references **`0x14248f8c0`**, if BN UI shows one — MCP **`get_xrefs_to`** on the string alone was empty.

Cross-link: **§H** “bounce TTL packet back” remains **open** until a branch explicitly **reflects** or **drops** on the TTL field.

---

## 6) Goals: simulator vs “full game” parity

### Simulator scope (what this repo is aiming for)

The **target** is a **reasonable replica** of Tunnet’s endpoint traffic in the tools (`recovered-endpoint-scheduler`, message export, comparisons): right cadence, right branches for the tuples you care about, and **headers that match the game’s chosen values** where we have recovered them (today mostly as **32-bit integers** in code / JSON—the same bits the game packs into headers).

**Automatic phase progression** (story/zone systems writing `0x1c4` / `0x1c5` over time) is **out of scope**: treat saves as a **line-in** with **`pnpm sched:sequence`** / **`pnpm sched:compare`** (see **§9**), not something the simulator must replay from world state.

**“Exact strings of the headers”** here means: **bit-exact header values** plus stable renderings: see **`src/packet-header-format.ts`** (`formatHeaderExact`, **`MainframeHeaderU32`**) and **`out/message-sequence.json`** per-event **`headerHexU32` / `headerBytesLe` / `headerBytesBe`**. If the on-wire layout includes **extra bytes** beyond the 32-bit word, that framing is a **separate** capture task.

### Still in scope to improve the replica

1. **Public address → internal tuple** encoding: match the game for every tuple class the driver actually uses.
2. **Who can receive a send**: candidate construction and RNG sampling (**`sub_140673740` / `sub_140673b40`**) aligned with **`sub_1400af880`** / neighbor tables—not random placeholders.
3. **Same-tick ordering** where it changes who sends or what is seen first (receive vs scheduled send).
4. **Wire packet TTL** (initial value, decrement sites, expiry): **`src/simulator.ts`** is a **scaffold** with **`ttl === undefined` ⇒ never expires**; recover real rules from the binary (**§5 J**).

### Binary notes (background, not all required for the simulator)

- `0x1c4` / `0x1c5` **writers** outside the scheduler (**`sub_1401f5660`**, **`sub_140165cb0`**, …) matter for **full** game fidelity; for the **simulator**, seeding initial **`phaseA` / `phaseB`** is enough.
- Scheduler-only **`0x1c4`** ladder **`5→6→7`** remains documented in **`applyRecoveredStateTransitions`**; **`BinaryObservedPhaseA`** lists other values seen in the binary for reference.

### MCP timeouts (`read timed out` / `Not connected`)

These are almost always **process or socket** issues on the BN side, not your repo:

1. **Binary Ninja must stay running** with `tunnet.exe.bndb` open; closing BN drops the bridge immediately (`Not connected`).
2. **First request after idle** can exceed a short HTTP timeout — retry `list_binaries` once; if it keeps timing out, restart the MCP bridge / BN plugin listener (whatever starts `localhost:9009`).
3. **Heavy views** (huge decompile on first open): wait until analysis quiesces, then retry a small call (`list_binaries`, then `function_at`).
4. Keep the **one-request-at-a-time** rule; parallel MCP calls still correlate with disconnects.

---

## 7) Repeatable MCP extraction recipe

### Step 1: Sanity check connection

1. `list_binaries`
2. verify active binary is `tunnet.exe.bndb`

### Step 2: Re-anchor send path

1. `list_imports`
2. locate `send`, `sendto`, `WSASend`
3. `get_xrefs_to(import_addr)`
4. `decompile_function(wrapper)`

### Step 3: Climb call graph

1. `get_xrefs_to(wrapper_addr)`
2. `decompile_function(caller)`
3. repeat until endpoint processing/tick branches are visible

### Step 4: Extract scheduler rules

From `sub_1402f9a40`, record:

- tuple guards (`a,b,c,d`)
- tick gates per branch
- packet profile/header assignment path
- side-condition calls (especially `sub_1406b6550`)

### Step 5: Extract randomness path

When branch selects among candidates, follow:

- `sub_140673b40`
- `sub_140673740`
- `sub_1406734a0`

Record exactly when sampling occurs and what candidate arrays are passed.

For a **static inventory of every `.text` call to `sub_140673b40`** and the decoded **literal strings** in each candidate vector (no MCP required), run **`pnpm extract:packet-pools`** — see **§9** (**`scripts/extract-packet-string-pools.py`**). Three call sites on the stock build still need CFG/BN follow-up (**§9** lists RVAs).

### Step 6: Validate lifecycle/ordering

In `sub_1402f5840`, trace slot/state field updates (`+0x7a` and related payload fields) to resolve:

- receive vs scheduled send precedence (**partially documented §E.1a**: **`0x1402f5bfe` vs `0x1402f75bf`**, **`0x1402f5bdb` / `rdi_43` loop**)
- wire-level **wrong-address bounce** vs normal send (**not** the **`SendBack`** serde xrefs — **§E.1b**; still trace **`sub_14044eae0` / `sub_1400af880`** families)
- drop/reset transitions
- **TTL / hop field** (if distinct from the above): initial write, decrements, expiry — see **§5 J**

---

## 8) Recovery when MCP disconnects

If you see `Connection closed` / `Not connected`:

1. Stop issuing further calls.
2. Run single `list_binaries`.
3. If still disconnected, re-focus/reopen `tunnet.exe.bndb` in Binary Ninja.
4. Retry `list_binaries` until active view appears.
5. Resume from last function/address checkpoint.

---

## 9) Current repo artifacts

### Core sources

- **`src/simulator.ts`**
  - **Topology tick simulator** (endpoints / relays / hubs / filters): optional **`Packet.ttl`**, bounce decrement, filter operating-port decrement, **`ttlExpired`** / **`bounced`** stats. **`ttl === undefined` ⇒ no countdown** (infinite-life scaffold). **Not** recovered from **`tunnet.exe`**; replace with **§5 J** once the wire field and rules are known.

- **`src/recovered-endpoint-scheduler.ts`**
  - Recovered scheduler: `evaluateEndpointSend`, `applyRecoveredStateTransitions` (today: **`sub_1402f5840`** status ladder for `0x1c4` only).
  - **`BinaryObservedPhaseA`**: named constants for `*(node+0x1c4)` values seen in the binary (scheduler **`5`–`7`**, zone fn **`sub_140165cb0`** **`0xc`–`0xe`**, **`0x13`**).
  - **`initialRecoveredSchedulerState(phaseA?, phaseB?)`**: builds `{ phaseA, phaseB }` mirroring game **`0x1c4` / `0x1c5`** at simulation start (“save” line-in).

- **`src/scheduler-comparison.ts`**
  - **`compareRecoveredAgainstCurrentImplementation(ticks, dataPath, encodingStrategy, initialRecoveredState?)`** — fourth argument is initial **`RecoveredSchedulerState`** (default **`{ phaseA: 0, phaseB: 0 }`**).

- **`src/export-message-sequence.ts`**
  - Writes **`out/message-sequence.json`**. Each event includes **`header`** (number) plus **`headerHexU32`**, **`headerBytesLe`**, **`headerBytesBe`** from **`formatHeaderExact`** (see below).

- **`src/packet-header-format.ts`**
  - **`formatHeaderExact(header)`** — exact string forms of the 32-bit header: literal-style **`0x…`**, little-endian byte hex, big-endian byte hex.
  - **`MainframeHeaderU32`** — fixed mainframe phase header words (`a === 4`, `phaseB` **0..5**) for cross-checks against BN.

- **`src/game-packet-strings.ts`**
  - Curated **subject / copy** literals wired into the simulator for specific **`evaluateEndpointSend`** profiles (**status-family**, **ad-family**, **search-family** rotation, etc.). Each pool matches rows passed to **`sub_140673b40`** on known branches; **`pick*Placeholder`** helpers are **tick-based stand-ins** until **`sub_140673b40`** / RNG state is ported (**`packetSubjectPickMode`** in **`out/message-sequence.json`** stays **`placeholder`** until then).
  - For the **full static list** of pools from the binary (not profile-keyed), use **`pnpm extract:packet-pools`** → **`out/packet-string-pools.json`** (**§9** below).

- **`scripts/extract-packet-string-pools.py`** (+ **`pnpm extract:packet-pools`**)
  - **Purpose:** Offline PE scan of **`tunnet.exe`**: find every **`call`** in **`.text`** whose displacement targets **`sub_140673b40`** (VA **`0x140673b40`**, RVA **`0x673b40`**, PE ImageBase **`0x140000000`** on the stock Steam build).
  - **Method:** Walk backward from each callsite through the MSVC-style **slot builder** (**`lea rax, [rip+disp]`** → store pointer → store **`imm32`** length in **`[rsi|rbx|rdi]+disp`**, sometimes **`mov qword [rsp+disp], imm`** / **`mov byte [rsp+0x73], 1`** filler) until **`mov edx`, pool size**, optionally **`lea r8,[rsp+0x78]`**, then **`call`**.
  - **Output:** **`out/packet-string-pools.json`** (under **`out/`**, gitignored). Top-level fields include **`callSiteCount`**, **`decodedOkCount`**, **`decodedFailCount`**, **`noMovEdxCount`**, **`imageBase`**, **`calleeRva`**. Each **`pools[]`** entry has **`callRva`** / **`callRvaHex`**, **`poolSize`**, **`strings`** (ordered as in memory before the uniform pick), **`decodeStatus`** (**`ok`** | **`fail`** | **`no_mov_edx`**), **`decodeError`** (tail hex / reason when not **`ok`**), **`rcxNote`** (how **`rcx`** was set before the call, e.g. **`rcx_rsi`**, **`rcx_r14`**).
  - **Coverage (stock Steam `tunnet.exe`):** **25** callsites found; **22** decode with **`decodeStatus: ok`**. **3** remain **`fail`** (**`0x2fb46a`**, **`0x2fb782`**, **`0x2fb82c`**) — XMM / **`jmp`** / Rust **`&str`** paths the linear decoder does not follow; recover with Binary Ninja (CFG) or extend **`scripts/extract-packet-string-pools.py`**. Hints: **`0x2fb782`** / **`0x2fb82c`** share the **`CONFIDENTIAL` / `TOP SECRET`** builder with **`0x2fb62f`**; **`0x2fb46a`** is **`rcx = r14`** with corn **`&str`** metadata at **`0x1424247d8`** and architect text nearby in **`.rdata`**.
  - **Scope limits:** Only strings reached via **`sub_140673b40`**. Other packet copy paths (no call to this helper, different binaries, future patches) are **not** included. Re-run after game updates; RVAs and codegen can shift.
  - **CLI:** `python scripts/extract-packet-string-pools.py [--exe path/to/tunnet.exe] [--out path/to.json]`

- **`scripts/extract-tunnet-rdata-strings.py`** (+ **`pnpm extract:exe-strings`**)
  - Dumps **every** contiguous printable-ASCII run in the chosen PE section(s) (default **`.rdata`**, default **`--min-len 0`** = length **≥ 1**) to **`out/tunnet-rdata-strings.jsonl`**—**no content filter**, no second output file. There is **no VA range** beyond full section bounds. Use **`rg`** / **`grep`** on that JSONL to narrow (file is huge at **`--min-len 0`**). **`--min-len N`** (N ≥ 1) shortens runs; **`--sections .rdata,.text`** adds sections; **`--exe`** sets the binary path.

### CLI: set initial phase (save line-in)

Both **`pnpm sched:sequence`** and **`pnpm sched:compare`** accept optional trailing **`phaseA`** / **`phaseB`** after **`ticks`** and optional **`encodingStrategy`**:

| Arguments | Meaning |
|-----------|---------|
| `ticks` | Tick count (required for explicit non-default; default **2048** sequence / **4096** compare). |
| `encodingStrategy` | One of **`identity`**, **`plus_one_all_octets`**, **`plus_one_first_octet`**. If omitted, default is **`plus_one_all_octets`**. |
| `phaseA` | Initial **`*(+0x1c4)`**-mirroring value (integer). |
| `phaseB` | Initial **`*(+0x1c5)`**-mirroring value (integer). |

If **`argv[1]`** is not a known strategy string, it is parsed as **`phaseA`** (strategy stays default). Examples:

```bash
pnpm sched:sequence 2048 plus_one_all_octets 5 2
pnpm sched:sequence 2048 identity 6 0
pnpm sched:sequence 4096 5 3
pnpm sched:compare 4096 plus_one_all_octets 5 0
```

**`out/message-sequence.json`** `metadata` includes **`initialPhaseA`**, **`initialPhaseB`** (start) and **`phaseA`**, **`phaseB`** (end of run after any modeled transitions). Each **`events[]`** item includes **`headerHexU32`**, **`headerBytesLe`**, **`headerBytesBe`** alongside numeric **`header`**.

### MCP / BN quirk

- **`function_at`** may return a valid function name in the payload while the Cursor MCP client reports a **schema validation error** (expects a plain string). Prefer **`decompile_function("sub_…")`** when you already know the name (e.g. **`sub_140165cb0`** for the secondary **`0x1c5`** site near **`0x140166850`**).

---

## 10) Practical guidance

- Follow dataflow, not symbol names (Rust binary has many generic wrappers).
- Keep a live notebook of:
  - function address
  - inferred role
  - extracted invariants
- Never trust one branch in isolation; always tie:
  - tuple guard
  - tick gate
  - state gate
  - candidate selection method
  - slot/state write-back
