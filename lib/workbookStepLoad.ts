import { loadOpenLoops } from "./openLoopsLoad";
import { workbookStepFor, type WorkbookStep } from "./workbookStep";

export function loadWorkbookStep(id: string): WorkbookStep | null {
  try {
    return workbookStepFor(loadOpenLoops(), id);
  } catch {
    return null;
  }
}
