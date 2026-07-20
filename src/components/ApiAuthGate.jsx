import React, { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RotateCcw } from "lucide-react";
import {
  API_UNAUTHORIZED_EVENT,
  ApiClientError,
  apiRequest,
  clearApiAccessToken,
  getApiAccessToken,
  setApiAccessToken,
} from "../services/apiClient.js";

function ApiAuthGate({ children }) {
  const [state, setState] = useState("checking");
  const [error, setError] = useState("");
  const [principal, setPrincipal] = useState(null);
  const [token, setToken] = useState("");

  const probe = useCallback(async (signal) => {
    const hadCredential = Boolean(getApiAccessToken());
    setState("checking");
    setError("");
    try {
      const currentPrincipal = await apiRequest("/api/v1/auth/me", {
        signal,
        timeoutMs: 10_000,
        fallbackMessage: "无法连接 API 服务",
      });
      if (!currentPrincipal?.roles?.some((role) => ["viewer", "editor", "admin"].includes(role))) {
        clearApiAccessToken();
        setPrincipal(null);
        setState("unauthenticated");
        setError("当前令牌仅用于服务调用，不能登录交互式工作台。");
        return;
      }
      setPrincipal(currentPrincipal);
      setToken("");
      setState("authenticated");
    } catch (requestError) {
      if (requestError.code === "REQUEST_ABORTED") return;
      if (requestError instanceof ApiClientError && requestError.status === 401) {
        setPrincipal(null);
        setState("unauthenticated");
        setError(hadCredential ? "访问令牌无效或已失效。" : "请输入 API 访问令牌。");
        return;
      }
      setState("unavailable");
      setError(requestError.message || "API 服务当前不可用。");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    probe(controller.signal);
    return () => controller.abort();
  }, [probe]);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearApiAccessToken();
      setPrincipal(null);
      setState("unauthenticated");
      setError("API 会话已失效，请重新输入访问令牌。");
    };
    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  async function submitToken(event) {
    event.preventDefault();
    if (!token.trim()) {
      setError("请输入 API 访问令牌。");
      return;
    }
    setApiAccessToken(token);
    await probe();
  }

  function resetCredential() {
    clearApiAccessToken();
    setPrincipal(null);
    setToken("");
    probe();
  }

  if (state === "authenticated") {
    return children({
      hasCredential: Boolean(getApiAccessToken()),
      principal,
      resetCredential,
    });
  }

  return (
    <main className="api-auth-screen">
      <section className="api-auth-panel" aria-labelledby="api-auth-title">
        <div className="api-auth-icon" aria-hidden="true"><KeyRound size={22} /></div>
        <h1 id="api-auth-title">招标文件智能体</h1>
        {state === "checking" ? (
          <div className="api-auth-status" role="status">
            <Loader2 className="spin" size={18} />
            正在验证 API 服务
          </div>
        ) : state === "unavailable" ? (
          <>
            <p className="api-auth-error" role="alert">{error}</p>
            <button className="tool-button primary" type="button" onClick={() => probe()}>
              <RotateCcw size={16} />
              重新连接
            </button>
          </>
        ) : (
          <form className="api-auth-form" onSubmit={submitToken}>
            <label htmlFor="api-access-token">API 访问令牌</label>
            <input
              id="api-access-token"
              name="api-access-token"
              type="password"
              value={token}
              autoComplete="off"
              autoFocus
              onChange={(event) => setToken(event.target.value)}
            />
            {error ? <p className="api-auth-error" role="alert">{error}</p> : null}
            <button className="tool-button primary" type="submit">
              <KeyRound size={16} />
              进入系统
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export default ApiAuthGate;
