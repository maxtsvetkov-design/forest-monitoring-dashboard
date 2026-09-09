/**
 * The Permits feed's content.
 *
 * Unlike every other feed in this app, this one has no real system behind it
 * to read from — there is no permitting integration wired up (see the empty
 * state this replaced). What's here is the example content from the design
 * system's own Permits mockup (Figma node 3781:106159), reproduced as it was
 * designed rather than invented fresh — a stand-in for what a connected
 * permitting system would show, not a claim that these permits exist.
 *
 * Grouped by status (Incoming / Rejected / Approved) rather than the
 * mockup's own by-region grouping — Incoming leads the list, since those are
 * the ones actually waiting on a reader's decision (see PermitsList's own
 * Approve/Reject buttons). Every entry the mockup shipped reads as a
 * completed, granted action (an issue, an extension, a batch renewal), so
 * all of them land under Approved. Rejected and Incoming had no mockup
 * example to draw from, so their entries here are this app's own — written
 * to match the boundary-expansion/permit-conflict narrative the Al Maha
 * "Oryx numbers reduced" event already tells, not a second unrelated story.
 */
export interface PermitEntry {
  id: string;
  title: string;
  /** Present only for entries the design marks "APPROVED" — a batch-processed
   *  or extended permit carries no status pill in the source design. */
  approved?: boolean;
  timestamp: string;
  description: string;
  /** The ring colour around the entry's avatar and, where present, the
   *  "View permit" link's target — absent for the batch-processed entry,
   *  which links to no single permit. */
  ringColor: string;
  viewPermitId?: string;
}

export interface PermitSection {
  status: "Approved" | "Rejected" | "Incoming";
  entries: PermitEntry[];
}

export const PERMIT_SECTIONS: PermitSection[] = [
  {
    status: "Incoming",
    entries: [
      {
        id: "AP-4041",
        title: "Access permit pending review",
        timestamp: "just now",
        description:
          "Permit AP-4041 requested for the Al Maha boundary block, pending review — the claimed area overlaps " +
          "two permits already rejected over the same disputed ground.",
        ringColor: "#a5690a",
      },
      {
        id: "AP-4044",
        title: "Access permit pending review",
        timestamp: "2 hours ago",
        description:
          "Permit AP-4044 requested for the adjoining stretch of the same block, pending review alongside " +
          "AP-4041 — both claims sit over ground already flagged for the water-flow conflict.",
        ringColor: "#a5690a",
      },
    ],
  },
  {
    status: "Rejected",
    entries: [
      {
        id: "AP-4033",
        title: "Access permit rejected",
        timestamp: "1 day ago",
        description:
          "Permit AP-4033 requested for the Al Maha boundary block was rejected — the area sits inside the " +
          "recently expanded protected zone, whose ground-water flow now conflicts with the access requested.",
        ringColor: "#c0392b",
      },
      {
        id: "AP-4029",
        title: "Access permit rejected",
        timestamp: "5 days ago",
        description:
          "Permit AP-4029 requested for the same Al Maha block was rejected for overlapping an already-issued " +
          "permit over the disputed ground — a second claim on land already under review.",
        ringColor: "#c0392b",
      },
    ],
  },
  {
    status: "Approved",
    entries: [
      {
        id: "AP-4021",
        title: "Access permit issued",
        approved: true,
        timestamp: "2 days ago",
        description:
          "Permit AP-4021 issued to Dr. Khalid Al Mansouri for Jubail Island mangrove zone. Valid for 14 days, research access.",
        ringColor: "#8c8c8c",
        viewPermitId: "AP-4021",
      },
      {
        id: "AP-4008",
        title: "Access permit issued",
        approved: true,
        timestamp: "7 days ago",
        description:
          "Permit AP-4008 issued to Marine Research Centre for Bu Tinah Island mangrove corridor. Valid for 21 days.",
        ringColor: "#8c8c8c",
        viewPermitId: "AP-4008",
      },
      {
        id: "AP-3997",
        title: "Visitor permit extended",
        timestamp: "8 days ago",
        description: "Permit AP-3997 for Saadiyat mangrove boardwalk extended by 14 days per ranger request.",
        ringColor: "#e55c2f",
      },
      {
        id: "AP-4018",
        title: "Access permit issued",
        approved: true,
        timestamp: "3 days ago",
        description:
          "Permit AP-4018 issued to EAD survey team for Khor Kalba reserve. Valid for 7 days, field monitoring access.",
        ringColor: "#8c8c8c",
        viewPermitId: "AP-4018",
      },
      {
        id: "AP-batch-1",
        title: "Permit batch processed",
        timestamp: "4 days ago",
        description: "12 seasonal access permits renewed for Al Zorah mangrove conservation zone.",
        ringColor: "#0a7761",
      },
      {
        id: "AP-4012",
        title: "Access permit issued",
        approved: true,
        timestamp: "6 days ago",
        description:
          "Permit AP-4012 issued to Sharjah Environment Authority for Ras Al Khor wildlife sanctuary. Valid for 30 days.",
        ringColor: "#8c8c8c",
        viewPermitId: "AP-4012",
      },
    ],
  },
];
