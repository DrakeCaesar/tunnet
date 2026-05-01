/**
 * Binary anchors for **TTL / hop-lifetime / TTL-adjacent** recovery (scheduler, relay, rows, encode drain).
 *
 * Narrative summary: **`analysis/RECOVERED_TTL.md`**. Full evidence chain: **`analysis/BINARY_NINJA_MCP_WORKFLOW.md`** **§J**.
 *
 * Most symbols **re-export** from **`recovered-endpoint-scheduler.ts`** so VAs stay single-sourced; helpers below are cited heavily in TTL notes but were not pinned in the scheduler module.
 */

export {
  BinaryData142428768,
  BinaryData142428768DwordAtPlus8,
  BinaryData142428768Plus8Va,
  BinaryPacketSlotModeCleared,
  BinaryPacketSlotModeCompose,
  BinaryPacketSlotModePingPongStaging,
  BinaryPacketSlotModeOffset,
  BinaryPacketSlotPriorModeOffset,
  BinaryPacketSlotStagingHighByteOffset,
  BinaryRdataVtableSlotSub1405f0920,
  BinaryRdataVtableSlotSub1407ad390,
  BinaryRdataWsaIoVtableRoot144d59a88,
  BinaryRdataWsaSendPtrAt144d59ae8,
  BinarySub1402f5840CallSub1404628b0Sites,
  BinarySub1402f5840CallSub14204f0e0Refill,
  BinarySub1402f5840GateAComposeCmp7a,
  BinarySub1402f5840GateBTapeReloadJe,
  BinarySub1402f5840InfectionRowStoreVar300AtPlus18,
  BinarySub1402f5840LoadVar300FromTapeRow,
  BinarySub1402f5840MemcpyVar308ToRingSlot0x90,
  BinarySub1402f5840PhishingTitleTableLenAtPlus48,
  BinarySub1402f5840SaveIncomingRcxdAtRsp1e0,
  BinarySub1402f5840SlotPackAfterFmt,
  BinarySub1402f5840StoreTapeRowPtrRsp298,
  BinarySub1402f5840TapeToBeepRingRowPlus18,
  BinarySub1402f9a40,
  BinarySub1402f9a40StoreArg1Plus18,
  BinarySub14037bf80,
  BinarySub14037de30,
  BinarySub14044eae0,
  BinarySub14044eae0PongClearVar218,
  BinarySub14044eae0RelayDecrementSlot1Q,
  BinarySub1404628b0,
  BinarySub140516d40,
  BinarySub140516d40CallSites,
  BinarySub140516d40FromRelayCallSites,
  BinarySub140516d40StoreArg2Int128AtRowPlus10,
  BinarySub140516f40,
  BinarySub1405208d0,
  BinarySub1405211a0,
  BinarySub14054fff0CallSub1407baf90,
  BinarySub1405f0920CallSub1407baf90,
  BinarySub14079a770,
  BinarySub1407ad390CallSub1407baf90,
  BinarySub1407baf90,
  BinarySub1407baf90RowLoadPlus58AsCount,
  BinarySub1407baf90RowLoadTupleBasePlus50,
  BinarySub14082c450CallSub142345a90,
  BinarySub14083e490IndirectCallRbpPlus20,
  BinarySub14083e490LeaVtable144d59a88,
  BinarySub1420519a0,
  BinarySub142052f70,
  BinarySub14204f0e0,
  BinarySub142313210,
  BinarySub1423a0360,
  BinarySub1423af220,
  BinarySub1423b0fc0,
} from "./recovered-endpoint-scheduler.js";

/** Tuple / prefix gate in **`sub_1402f5840`** — **not** TTL arithmetic (**`analysis/BINARY_NINJA_MCP_WORKFLOW.md`** **§J.4**). */
export const BinarySub1406b6550 = "0x1406b6550" as const;

/** Neighbor **`0x38`**-stride row exchange with **`&var_308`** (**§J.4.4**). */
export const BinarySub14037d450 = "0x14037d450" as const;

/** Open-hash insert / **`var_308`** key write; metadata decrement on table header (**§J.4**). */
export const BinarySub140643f00 = "0x140643f00" as const;

/** Keyed lookup; in **`2f5840`**, **`arg2`** is **`{saved rcx, saved rdx}`**, not **`0x58` row `+0x48`** (**§J.4.10.4**). */
export const BinarySub142244e00 = "0x142244e00" as const;

/** Buffer growth / push-bytes helper (often after **`{@link BinarySub142244e00}`**) — **§J** / **§J.4.13**. */
export const BinarySub141fcee80 = "0x141fcee80" as const;
