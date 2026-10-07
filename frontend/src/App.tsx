import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { statusName } from "./format";
import type {
  Health,
  HistoryItem,
  Investigation,
  Preset,
  Scope,
  Screen,
  VerifiedImport,
} from "./types";
import Sidebar from "./components/Sidebar";
import InvestigationView from "./components/InvestigationView";
import type { InvestigationTab } from "./components/InvestigationView";
import ImportPanel from "./components/ImportPanel";
import ReviewPanel from "./components/ReviewPanel";
import BotPanel from "./components/BotPanel";

const initialScope: Scope = {
  address: "",
  token_address: "",
  from_block: 24106368,
  to_block: 24106388,
  mode: "offline",
  agent_mode: "offline",
};
const pending = (investigation: Investigation | null) =>
  ["running", "pending", "stopping"].includes(investigation?.status ?? "");
const params = new URLSearchParams(window.location.search);
const storageKey = `cluetide:${params.get("client") === "second" ? "second" : "primary"}:investigation`;
const isPreset = (value: unknown): value is Preset => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.case_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item.case_id) &&
    typeof item.title === "string" && item.title.length > 0 && item.title.length <= 200 &&
    typeof item.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(item.address) &&
    typeof item.token_address === "string" && /^0x[0-9a-fA-F]{40}$/.test(item.token_address) &&
    typeof item.from_block === "number" && Number.isSafeInteger(item.from_block) && item.from_block >= 0 &&
    typeof item.to_block === "number" && Number.isSafeInteger(item.to_block) && item.to_block >= item.from_block &&
    item.to_block - item.from_block < 2000;
};

export default function App() {
  const [showBot, setShowBot] = useState(false);
  const [botOpened, setBotOpened] = useState(false);
  const [screen, setScreen] = useState<Screen>(
    params.get("view") === "bundles" ? "bundles" : "workbench",
  );
  const [tab, setTab] = useState<InvestigationTab>("overview");
  const [scope, setScope] = useState(initialScope);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetLoading, setPresetLoading] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [investigation, setInvestigation] = useState<Investigation | null>(
    null,
  );
  const [imported, setImported] = useState<VerifiedImport | null>(null);
  const [importCase, setImportCase] = useState<Investigation | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const startController = useRef<AbortController | null>(null);
  const startInFlight = useRef(false);
  const lastStartAt = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);
  const presetLoadRef = useRef(0);
  const presetInFlight = useRef(false);
  const busy = starting || pending(investigation);
  const refreshHistory = () =>
    api
      .history()
      .then(setHistory)
      .catch(() => undefined);
  const loadPreset = async (id = "uniswap93", prepare = false) => {
    const sequence = ++presetLoadRef.current;
    presetInFlight.current = true;
    setPresetLoading(true);
    try {
      const preset = await api.preset(id);
      if (sequence !== presetLoadRef.current) return;
      if (!isPreset(preset)) throw new Error("Invalid case preset");
      setPresets((previous) => previous.some((item) => item.case_id === preset.case_id) ? previous : [...previous, preset]);
      setScope((previous) => ({
        ...previous,
        address: preset.address,
        token_address: preset.token_address,
        from_block: preset.from_block,
        to_block: preset.to_block,
        mode: "offline",
        agent_mode: "offline",
      }));
      if (prepare) {
        setInvestigation(null);
        setSelectedId(null);
        localStorage.removeItem(storageKey);
        setTab("overview");
      }
      setError("");
    } catch {
      if (sequence === presetLoadRef.current)
        setError("无法加载案例，请确认本地 API 正在运行后重试。");
    } finally {
      if (sequence === presetLoadRef.current) {
        presetInFlight.current = false;
        setPresetLoading(false);
      }
    }
  };
  const restoreInvestigation = (result: Investigation) => {
    setInvestigation(result);
    const savedScope = result.input ?? result.evidence?.request;
    if (savedScope)
      setScope((previous) => ({
        ...previous,
        ...savedScope,
        mode: result.input?.mode ?? (result.mode === "rpc" ? "rpc" : "offline"),
        agent_mode: result.input?.agent_mode ?? previous.agent_mode,
      }));
  };
  const openInvestigation = async (id: string) => {
    try {
      const result = await api.get(id);
      restoreInvestigation(result);
      setScreen("workbench");
      setTab("overview");
      setError("");
    } catch {
      setError("无法打开已保存的调查。");
    }
  };
  useEffect(() => {
    void refreshHistory();
    void api.catalog().then((catalog) => {
      if (!Array.isArray(catalog?.cases)) return;
      const unique = new Map<string, Preset>();
      catalog.cases.slice(0, 32).filter(isPreset).forEach((item) => unique.set(item.case_id, item));
      if (unique.size) setPresets([...unique.values()]);
    }).catch(() => undefined);
    void api
      .health()
      .then(setHealth)
      .catch(() => setError("本地 API 未连接。请启动后端后点击“重试连接”。"));
    const storedId = localStorage.getItem(storageKey);
    if (storedId)
      void api
        .get(storedId)
        .then(restoreInvestigation)
        .catch(() => {
          localStorage.removeItem(storageKey);
          void loadPreset();
        });
    else void loadPreset();
    return () => startController.current?.abort();
  }, []);
  useEffect(() => {
    if (investigation?.id) localStorage.setItem(storageKey, investigation.id);
  }, [investigation?.id]);
  useEffect(() => {
    if (!pending(investigation)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const result = await api.get(investigation!.id, controller.signal);
        if (cancelled) return;
        setInvestigation(result);
        if (pending(result)) timer = setTimeout(() => void poll(), 1000);
        else {
          setStopping(false);
          void refreshHistory();
        }
      } catch (error) {
        if (!cancelled) {
          setError(
            error instanceof Error ? error.message : "调查状态读取失败。",
          );
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [investigation?.id, investigation?.status]);
  const start = async () => {
    const now = performance.now();
    if (
      startInFlight.current ||
      presetInFlight.current ||
      busy ||
      (lastStartAt.current !== null && now - lastStartAt.current < 600)
    )
      return;
    if (
      scope.agent_mode === "live" &&
      health?.live_available !== true &&
      health?.live_agent_available !== true &&
      health?.capabilities?.live_agent_available !== true
    ) {
      setError("实时 Agent 当前不可用，请选择离线工具演示。");
      return;
    }
    startInFlight.current = true;
    lastStartAt.current = now;
    stopRequestedRef.current = false;
    setStarting(true);
    setError("");
    setScreen("workbench");
    setTab("overview");
    setSelectedId(null);
    setInvestigation(null);
    const controller = new AbortController();
    startController.current = controller;
    try {
      const accepted = await api.investigate(scope, controller.signal);
      setInvestigation(accepted);
      if (stopRequestedRef.current) {
        const stopped = await api.stop(accepted.id);
        setInvestigation(stopped);
      }
    } catch (error) {
      if (controller.signal.aborted) setError("已取消等待；尚未取得任务 ID。");
      else
        setError(error instanceof Error ? error.message : "调查请求未完成。");
    } finally {
      startInFlight.current = false;
      stopRequestedRef.current = false;
      startController.current = null;
      setStopping(false);
      setStarting(false);
    }
  };
  const stop = async () => {
    if (!investigation?.id) {
      if (startInFlight.current) {
        stopRequestedRef.current = true;
        setStopping(true);
      }
      return;
    }
    setStopping(true);
    try {
      const result = await api.stop(investigation.id);
      setInvestigation(result);
      if (!pending(result)) setStopping(false);
    } catch (error) {
      setStopping(false);
      setError(error instanceof Error ? error.message : "停止请求未完成。");
    }
  };
  const reviewTarget = screen === "bundles" ? importCase : investigation;
  const importedVersion = importCase?.versions.find(
    (version) => version.content_hash === imported?.manifest_hash,
  );
  const mutate = async (operation: () => Promise<unknown>) => {
    await operation();
    const result = await api.get(reviewTarget!.id);
    setInvestigation(result);
    if (importCase?.id === result.id) setImportCase(result);
  };
  const onImport = async (file: File) => {
    setImported(null);
    setImportCase(null);
    setImportNotice("");
    setError("");
    const result = await api.import(file);
    setImported(result);
    const caseId = result.report.case_id;
    if (typeof caseId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(caseId)) {
      try {
        const original = await api.get(caseId);
        if (
          original.versions.some(
            (version) => version.content_hash === result.manifest_hash,
          )
        ) {
          setImportCase(original);
          setInvestigation(original);
        } else
          setImportNotice(
            "完整性校验通过；本地登记未找到匹配的内容哈希，不能绑定本地版本复核。",
          );
      } catch {
        setImportNotice(
          "完整性校验通过；对应调查未在当前本地服务器找到。可审阅 ZIP 中的公开证据。",
        );
      }
    } else setImportNotice("完整性校验通过；证据包未指向可关联的本地调查。");
    void refreshHistory();
  };
  const title =
    screen === "bundles"
      ? "证据包导入与复核"
      : screen === "review"
        ? "协作复核与版本"
        : (investigation?.title ?? presets.find((item) =>
          item.address.toLowerCase() === scope.address.toLowerCase() &&
          item.token_address.toLowerCase() === scope.token_address.toLowerCase() &&
          item.from_block === scope.from_block && item.to_block === scope.to_block)?.title ?? "Ethereum 事件调查");
  return (
    <div className="app-shell">
      <Sidebar
        screen={screen}
        onScreen={setScreen}
        scope={scope}
        onScope={setScope}
        onStart={() => void start()}
        onStop={() => void stop()}
        onPreset={(id) => void loadPreset(id, true)}
        presets={presets}
        presetLoading={presetLoading}
        busy={busy}
        stopping={stopping}
        health={health}
        history={history}
        onOpen={(id) => void openInvestigation(id)}
      />
      <main className="workspace">
        <div className="workbench-frame">
          <header className="page-header">
            <div>
              <h1>{title}</h1>
              <p>
                {screen === "bundles"
                  ? "在第二客户端验证完整性，再审阅证据与结论。"
                  : screen === "review"
                    ? "保留原始报告、复核意见与更正记录。"
                    : "从事件告警到候选解释，核对每一步证据。"}
              </p>
            </div>
            <div className="header-actions">
              <button className="button outline" type="button" data-testid="bot-open" aria-expanded={showBot}
                onClick={() => { setBotOpened(true); setShowBot((previous) => !previous); }}>
                {showBot ? "收起 BOT 登记" : "BOT 链上登记"}
              </button>
              {screen === "workbench" ? (
                <>
                  <span className="run-status" aria-live="polite">
                    {scope.mode === "offline" ? "公开缓存" : "只读 RPC"} ·{" "}
                    {busy
                      ? "调查中"
                      : investigation
                        ? statusName(investigation.status)
                        : "本地复核"}
                  </span>
                  {investigation?.report && !busy ? (
                    <a
                      className="button outline"
                      href={api.bundleUrl(investigation.id)}
                      download
                    >
                      导出证据 ZIP
                    </a>
                  ) : (
                    <button className="button outline" disabled>
                      导出证据 ZIP
                    </button>
                  )}
                </>
              ) : (
                <button
                  className="button outline"
                  type="button"
                  onClick={() => setScreen("workbench")}
                >
                  返回调查
                </button>
              )}
            </div>
          </header>
          {error && (
            <div className="error-banner global-error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  void api
                    .health()
                    .then((result) => {
                      setHealth(result);
                      setError("");
                      void loadPreset();
                    })
                    .catch(() =>
                      setError("本地 API 未连接。请启动后端后重试。"),
                    );
                }}
              >
                重试连接
              </button>
            </div>
          )}
          {botOpened ? <div hidden={!showBot} data-testid="bot-panel-container"><BotPanel investigation={reviewTarget} /></div> : null}
          {screen === "workbench" && (
            <nav className="tabs" aria-label="调查内容">
              {(
                [
                  ["overview", "调查概览"],
                  ["evidence", "原始证据"],
                  ["trace", "Agent 轨迹"],
                  ["versions", "版本与复核"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={tab === key ? "active" : ""}
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? "page" : undefined}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          <div
            className={`page-content ${screen !== "workbench" ? "standalone-content" : ""}`}
          >
            {screen === "workbench" && tab !== "versions" && (
              <InvestigationView
                investigation={investigation}
                busy={busy}
                tab={tab}
                selectedId={selectedId}
                onEvidence={(id) => {
                  setSelectedId(id);
                  setTab("evidence");
                }}
              />
            )}
            {screen === "bundles" && (
              <ImportPanel imported={imported} onImport={onImport} />
            )}
            {screen === "bundles" && importNotice && (
              <p className="inline-notice" role="status">
                {importNotice}
              </p>
            )}
            {screen === "bundles" && importedVersion && (
              <p className="inline-notice">
                本地登记匹配：导入报告 v{imported?.report.revision ?? 1}
                。复核将绑定该版本及其内容哈希。
              </p>
            )}
            {(screen === "review" ||
              screen === "bundles" ||
              tab === "versions") && (
              <ReviewPanel
                investigation={reviewTarget}
                onReview={(reviewer, comment) =>
                  mutate(() =>
                    api.review(
                      reviewTarget!.id,
                      reviewer,
                      comment,
                      screen === "bundles"
                        ? importedVersion?.version_id
                        : undefined,
                    ),
                  )
                }
                onVersion={(
                  author,
                  correction,
                  parent,
                  correctedSummary,
                  claimReplacements,
                  assessmentReplacements,
                  correctedClassification,
                ) =>
                  mutate(() =>
                    api.version(
                      reviewTarget!.id,
                      author,
                      correction,
                      parent,
                      correctedSummary,
                      claimReplacements,
                      assessmentReplacements,
                      correctedClassification,
                    ),
                  )
                }
              />
            )}
            {screen === "workbench" && investigation?.evidence && (
              <div className="second-client-row">
                <a
                  className="text-button"
                  href="/?client=second&view=bundles"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开第二客户端复核
                </a>
                <span className="muted">导出后在该客户端导入 ZIP。</span>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
