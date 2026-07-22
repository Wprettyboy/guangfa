import { createContext, useContext } from "react";

const FillWorkspaceStateContext = createContext(null);
const FillWorkspaceActionsContext = createContext(null);

function FillWorkspaceProvider({ state, actions, children }) {
  return (
    <FillWorkspaceStateContext.Provider value={state}>
      <FillWorkspaceActionsContext.Provider value={actions}>
        {children}
      </FillWorkspaceActionsContext.Provider>
    </FillWorkspaceStateContext.Provider>
  );
}

function useFillWorkspaceState() {
  const value = useContext(FillWorkspaceStateContext);
  if (!value) throw new Error("FillWorkspaceStateContext is unavailable");
  return value;
}

function useFillWorkspaceActions() {
  const value = useContext(FillWorkspaceActionsContext);
  if (!value) throw new Error("FillWorkspaceActionsContext is unavailable");
  return value;
}

export { FillWorkspaceProvider, useFillWorkspaceActions, useFillWorkspaceState };
