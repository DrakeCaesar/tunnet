# Recovered TTL / hop-lifetime notes (Tunnet binary)

This file pulls together **everything the repo currently believes** about **time-to-live**, **remaining-hop-style counters**, and **TTL-adjacent fields** recovered from **`tunnet.exe`** via Binary Ninja. It is a **summary**; line-by-line evidence, tables, and exhausted leads stay in **`analysis/BINARY_NINJA_MCP_WORKFLOW.md`** **§J** (especially **§J.3–§J.5**).

**Not game truth:** `src/simulator.ts` TTL behavior is a **topology scaffold** (`ttl === undefined` ⇒ never expires). That design is **not** proven to match live slot layout until we map the same fields here into wire bytes.

**TypeScript pins:** `src/analysis/recovered-ttl.ts` re-exports scheduler anchors and adds a few helper VAs cited only in TTL narrative.

---

## 1. Questions we are answering

1. **Where** is an initial **TTL-like dword** (per-destination tape seed, compose stack, neighbor swap, `0x58` row, slot pack) **written**?
2. **What** decrements or mutates it on **relay / filter / bridge** paths?
3. **Whether** that dword is the **same bits** that appear **on the wire** (UDP) — **still open** for several paths (**§J.5**, Lead #1).

---

## 2. Vocabulary (do not conflate)

| Term | Meaning |
|------|--------|
| **`MainframeHeaderU32` / `var_10b`** | Header constant family from **`sub_1402f9a40`** — **not** the hop counter (**workflow §J.3.1**, **§J.4** intro). |
| **Tape `rax_11[1].d` / `var_300.d`** | **`dword *(tape_row + 8)`** after **`[[rsp+0x298]]`** reload (**Gate B**, **`0x1402f5ccf`** when **`*(slot+0x7a) != 2`**). Comes from **`sub_1404628b0` → `sub_1420519a0` / RNG** then **`sub_14204f0e0`** (ChaCha-style mix) — **not** raw **`0x424286e0`** at **`row+8`** (**§J.3.2**). |
| **Ring row `+0x18` (40-byte stride)** | On beep/PINGPONG path, **`var_200`** (= **`var_300.d`** on tape branch) stored at **deque row `+0x18`** (**§J.4**, **§J.4.8**). |
| **`0x58` row `+0x48`** | **`arg2[4]`** dword from **`sub_140516d40`** callers — **same logical dword** as **`rax_11[1].d`** on scheduler sites that pack **`[rsp+0x148]`** from **`[rsp+0x1a8]`** (**§J.4.1**). |
| **`*(arg1[2]+0x48)`** in **`516d40`** | **Deque routing flag** — **not** the **`arg2[4]`** dword (**§J.4.11**). |
| **`slot+0x48`** on live **`NetNode`** | **Overloaded**: tape-related packs **vs** SIMD bitmask branch (**§J.4.9**). |
| **`sub_1405208d0` `*(arg1+0x18)`** | **Rust `String` / allocator math** — **closed as non–hop-TTL** (**§J.4.5**). |

---

## 3. Scheduler gates (compose vs tape dword reload)

- **Gate A — `*(slot+0x7a)==2` ⇒ `sub_1402f9a40`:** **`0x1402f5bf5`** — **`§J.3.4`**.
- **Gate B — `*(slot+0x7a)==2` ⇒ skip `[[rsp+0x298]]+8 → [rsp+0x108]`:** **`0x1402f5cbd`–`0x1402f5cc1`** — **`§J.3.4` exhausted**.

**Implication:** on **compose**, **`var_300.d`** is **not** refreshed from the **tape ChaCha row** at that merge; TTL-like tooling must track **compose / neighbor / `516d40`** writers instead (**§J.3.4** conclusion).

---

## 4. Where the tape dword flows (when Gate B falls through)

1. **`var_300.d = rax_11[1].d`** @ **`0x1402f5cd2`** (**tape branch**).
2. **`var_200 = var_300.d`** @ **`0x1402f5da5`**.
3. Ring store **`*(ring_row + 0x18) = var_200`** @ **`0x1402f5f26`** (**§J.4.8**).
4. **`sub_140516d40`** packs **`arg2[4]`** so **`dword` lands at `0x58` row `+0x48`** (**§J.4.1**).

**Infection template:** **`var_300.d`** at **`row+0x18`** @ **`0x1402f8f09`** (**§J.4.8**).

---

## 5. Compose and neighbor swap (`+0x18` traffic)

- **`sub_1402f9a40`**: **`*(arg1+0x18) = var_130:8.q`** @ **`0x1402fbd3b`** — upper lane after **`var_f8`** / header pools (**§J.3.3**).
- **`sub_1423b0fc0` → `sub_1423af220`**: **`String` reserve** — **not** wire TTL (**§J.3.3**).
- **`sub_14037d450`**: swaps **`*(neighbor+0x18)`** with **`&var_308`** scratch (**§J.4.4**).

---

## 6. Slot pack after fmt (`+0x58` / `+0x60`)

**`sub_1423a0360`** does **not** assign **`var_200`**. After **`var_350` / `var_200.q`** staging:

- **`*(slot+0x58) = var_350`** @ **`0x1402f7581`**
- **`*(slot+0x60) = var_200.q`** @ **`0x1402f7585`** (**§J.4.9**)

**Relay **`sub_14044eae0` → `516d40`**: does **not** read **`slot+0x60`** on traced slices (**§J.4.9**).

---

## 7. Relay decrement heuristic (`slot[1].q`)

On **`label_14044f160` (B)** only: **`slot[1].q -= 1`** before **`516d40`** @ **`0x14044fae1`**. Other relay arms copy **verbatim** (**§J.1**, **§E.3**).

**Hypothesis:** **`slot[1].q`** is a **remaining-hop / classifier** on **(B)** — **not** proved identical to **tape `rax_11[1].d` → row `+0x48`** without a shared-writer proof (**§J.1**).

---

## 8. `memcpy` / `5211a0` / portal **`0x190`**

**Sites A–D** (**§J.4.2–§J.4.7**): **`sub_1405211a0` + `sub_1405208d0`** **clobber** **`rsp+0x108`** class scratch; **`memcpy(...,0x90)`** does **not** carry **`var_300`** as trailing **`0x90`** tail (**§J.1** bullet 1). **`0x190`** path → canned dialog (**§J.4.7**) — **not** **`rax_11[1].d`**.

---

## 9. Encode drain vs `WSASend` (Lead #1 partial)

- **`sub_1407baf90`**: **`0x60`** rows → **`sub_142244e00` → `sub_141fcee80`**; **no `row+0x48`** load (**§J.4.13**).
- **`sub_1405f0920` / `sub_1407ad390`**: **vtable-only** entries (**.rdata** **`0x1424a9e00` / `0x1424a9df8`**) — **§J.4.14**.
- **`WSASend`**: **`82c450` → `142345a90`**; **HTTP-ish** **`83e490`** vtable **`0x144d59a88`** — **not merged** with **`7baf90`** (**§J.4.14**).

**Still missing:** proof that **`0x58` row `+0x48`** or **`slot+0x60`** copies into **UDP `sendto`** buffers (**§J.5**).

---

## 10. Initial TTL “profile” table (from §J.5)

| Source | TTL-like dword | All packets? |
|--------|----------------|--------------|
| **Tape / `0x7a != 2`** | **`rax_11[1].d` → ring `+0x18` / `516d40` `+0x48`** | **Per destination row** — varies with **`rdi_43`** (**§J.5**). |
| **Compose / `0x7a == 2`** | **Not** tape reload at **`0x1402f5ccf`** — from **`2f9a40`**, neighbors, later **`516d40`** | Only emits through compose + gates (**§J.5**). |
| **`516d40` / `memcpy 0x90`** | **`arg2+0x48` → row** vs **`String` metadata** confusion resolved in **§J.4.3–§J.4.5** | Subset; **`+0x3a==2`** skips **`516d40`** block (**§J.5**). |

---

## 11. Tooling gap

Until **`MessageEvent`** (or export JSON) carries something like **`ttlInitial`**, **`pnpm sched:sequence`** cannot regress **per-packet TTL** against captures (**§J.5** repo note).

---

## 12. Chamber / bridge hint (**§J.2**)

**`1.*.1.0`** chamber endpoints: bridge may **rewrite first octet** and **TTL**; relay-only slices show **at most `-1`** — multi-step decrements point **bridge-ward** (**§J.2**).

---

## See also

- **`analysis/BINARY_NINJA_MCP_WORKFLOW.md`** — **§J** (full BN narrative), **§E.3** (relay), **§H** (bounce lead).
- **`src/analysis/recovered-ttl.ts`** — VA exports for this topic.
- **`src/simulator.ts`** — scaffold TTL decrement (**not** recovered from binary).
