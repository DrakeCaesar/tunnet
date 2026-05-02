import { endpointData } from "../wiki-endpoint-data.js";

/** Fields used by recovered-scheduler comparisons and `compare-endpoint-edges` wiki baseline. */
export type WikiSchedulerEndpointRow = {
  address: string;
  send_rate: number;
  sends_to: string[];
  replies_to: string[];
};

export function wikiSchedulerEndpointRows(): WikiSchedulerEndpointRow[] {
  return endpointData.map((row) => ({
    address: row.address,
    send_rate: row.send_rate,
    sends_to: row.sends_to,
    replies_to: row.replies_to,
  }));
}
