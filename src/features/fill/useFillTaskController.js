import { useCallback, useEffect, useRef, useState } from "react";

function createFillTaskController() {
  let activeRun = null;
  let sequence = 0;

  function startRun() {
    activeRun?.controller.abort();
    const run = {
      id: ++sequence,
      controller: new AbortController(),
    };
    activeRun = run;
    return run;
  }

  function cancelRun() {
    if (!activeRun) return false;
    activeRun.controller.abort();
    activeRun = null;
    return true;
  }

  function isCurrentRun(run) {
    return activeRun === run && !run.controller.signal.aborted;
  }

  function finishRun(run) {
    if (activeRun !== run) return false;
    activeRun = null;
    return true;
  }

  return { startRun, cancelRun, isCurrentRun, finishRun };
}

export { createFillTaskController };

function useFillTaskController() {
  const controllerRef = useRef(createFillTaskController());
  const [generatingAll, setGeneratingAll] = useState(false);
  const [bulkFillProgress, setBulkFillProgress] = useState({ current: 0, total: 0 });

  const cancel = useCallback(() => {
    if (!controllerRef.current.cancelRun()) return false;
    setGeneratingAll(false);
    setBulkFillProgress({ current: 0, total: 0 });
    return true;
  }, []);

  const run = useCallback(async (total, task) => {
    if (generatingAll) return false;
    const currentRun = controllerRef.current.startRun();
    setGeneratingAll(true);
    setBulkFillProgress({ current: 0, total });
    try {
      await task({
        signal: currentRun.controller.signal,
        isCurrent: () => controllerRef.current.isCurrentRun(currentRun),
        setProgress: (current) => setBulkFillProgress({ current, total }),
      });
      return true;
    } finally {
      if (!controllerRef.current.finishRun(currentRun)) return;
      setGeneratingAll(false);
      setBulkFillProgress({ current: 0, total: 0 });
    }
  }, [generatingAll]);

  useEffect(() => () => {
    controllerRef.current.cancelRun();
  }, []);

  return { generatingAll, bulkFillProgress, cancel, run };
}

export { useFillTaskController };
