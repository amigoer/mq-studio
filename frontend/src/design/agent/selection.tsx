import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** One object a page has open in its detail panel, as the assistant hears of it. */
export type Selected = { kind: "topic" | "group" | "queue" | "subscription"; name: string };

type Report = (selected: Selected | null) => void;

const Reported = createContext<Selected | null>(null);
const Reporter = createContext<Report | null>(null);

/**
 * Holds what the page in front has selected. A page only knows its own
 * selection, and the dock beside it has to ask about the same object, so the
 * page reports it up here rather than the dock reaching down.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Selected | null>(null);
  return (
    <Reporter.Provider value={setSelected}>
      <Reported.Provider value={selected}>{children}</Reported.Provider>
    </Reporter.Provider>
  );
}

/**
 * Reports what a page has open, for as long as it has it open. A page that
 * closes the panel, or goes away, takes its selection with it.
 */
export function useReportSelection(kind: Selected["kind"], name: string | null | undefined) {
  const report = useContext(Reporter);
  useEffect(() => {
    if (report == null || name == null || name === "") return;
    report({ kind, name });
    return () => report(null);
  }, [report, kind, name]);
}

export const useSelection = (): Selected | null => useContext(Reported);
