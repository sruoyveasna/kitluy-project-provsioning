import { WfItemsPanel } from "./WfItemsPanel";
import { WfWeightPanel } from "./WfWeightPanel";

/** Wash & Fold step — optional garment checklist + required kg weight entry. */
export const WfServicePanel = () => (
  <div className="sv-wf-step">
    <WfWeightPanel />
    <WfItemsPanel />
  </div>
);
