/**
 * StudioContext — provides a way for AnnotationVersionPage to publish the
 * current drawing name (and versionId) so the Topbar can show a contextual
 * "Drawing Studio" tab while a drawing is open, without prop-drilling.
 */

import { createContext, useCallback, useContext, useState } from "react";

interface StudioState {
  versionId: string | null;
  drawingName: string | null;
}

interface StudioContextValue extends StudioState {
  setStudio: (versionId: string | null, drawingName: string | null) => void;
  clearStudio: () => void;
}

const StudioContext = createContext<StudioContextValue>({
  versionId: null,
  drawingName: null,
  setStudio: () => {},
  clearStudio: () => {},
});

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StudioState>({ versionId: null, drawingName: null });

  const setStudio = useCallback((versionId: string | null, drawingName: string | null) => {
    setState({ versionId, drawingName });
  }, []);

  const clearStudio = useCallback(() => {
    setState({ versionId: null, drawingName: null });
  }, []);

  return (
    <StudioContext.Provider value={{ ...state, setStudio, clearStudio }}>
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  return useContext(StudioContext);
}
