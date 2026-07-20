import { useEffect, useState } from "react";
import { apiRequest, isApiRequestUrl } from "../services/apiClient.js";

function useApiAssetUrl(source) {
  const sourceUrl = String(source || "");
  const [state, setState] = useState({ source: "", url: "", loading: false, error: "" });

  useEffect(() => {
    const value = sourceUrl;
    if (!value || !isApiRequestUrl(value)) {
      setState({ source: value, url: value, loading: false, error: "" });
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;
    let objectUrl = "";
    setState({ source: value, url: "", loading: true, error: "" });
    apiRequest(value, {
      responseType: "blob",
      signal: controller.signal,
      fallbackMessage: "图片读取失败",
    })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ source: value, url: objectUrl, loading: false, error: "" });
      })
      .catch((error) => {
        if (error?.code !== "REQUEST_ABORTED") {
          setState({ source: value, url: "", loading: false, error: error?.message || "图片读取失败" });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl]);

  if (state.source === sourceUrl) return state;
  const loading = Boolean(sourceUrl && isApiRequestUrl(sourceUrl));
  return { url: loading ? "" : sourceUrl, loading, error: "" };
}

export default useApiAssetUrl;
