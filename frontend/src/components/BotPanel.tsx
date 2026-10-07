import { useEffect, useRef, useState } from "react";
import type { Investigation } from "../types";
import type {
  BotAction, BotChainId, BotNetwork, BotPrepared, BotPrepareRequest,
  BotPublicRecord, BotReadResult, BotVerification,
} from "../bot-types";
import {
  addWalletNetwork, botApi, connectWallet, explorerLink, formatBot, isAddress,
  isBotAction, isDecimalId, isTransactionHash, parseAccounts, parseChainId,
  sendWalletTransaction, switchWalletNetwork, walletProvider, walletSnapshot,
} from "../bot-wallet";
import type { WalletProvider, WalletSnapshot } from "../bot-wallet";
import { getVerificationIntent, loadVerificationIntents, saveVerificationIntent, updateVerificationIntent } from "../bot-verification-store";
import type { VerificationIntent } from "../bot-verification-store";
import "../bot.css";

const historyKey = "cluetide:bot-public-transactions:v1";
const outcomeKey = "cluetide:bot-wallet-outcome:v1";
interface WalletOutcome { chain_id: BotChainId; action: BotAction; attempt_id?: string; status?: "attempting" | "unknown" }
function loadWalletOutcome(): WalletOutcome | null {
  try {
    const stored = localStorage.getItem(outcomeKey);
    if (!stored || stored.length > 500) return null;
    const value = JSON.parse(stored);
    if (value?.schema_version !== 1 || ![968, 677].includes(value.chain_id) || !isBotAction(value.action) ||
        (value.attempt_id !== undefined && (typeof value.attempt_id !== "string" || value.attempt_id.length > 100)) ||
        (value.status !== undefined && !["attempting", "unknown"].includes(value.status))) return null;
    return { chain_id: value.chain_id, action: value.action,
      ...(value.attempt_id ? { attempt_id: value.attempt_id } : {}), ...(value.status ? { status: value.status } : {}) };
  } catch { return null; }
}
const actionLabels: Record<BotAction, string> = {
  deploy: "1 · 部署登记合约",
  create_case: "2 · 登记案件 v1",
  add_review: "3 · 复核指定版本",
  append_version: "4 · 登记更正 v2",
};
const verificationLabels: Record<BotVerification["status"], string> = {
  pending: "等待回执或确认", failed: "链上执行失败", mismatch: "交易或合约状态不匹配", verified: "回执与 getter 核验通过",
};
const intentStatusLabel = (intent: VerificationIntent): string => {
  if (intent.status === "ready") return "核验参数已保存";
  if (intent.status === "uncertain") return "钱包结果待核查";
  if (intent.status === "rejected") return "钱包已取消";
  if (intent.status === "submitted") return "哈希已关联";
  return verificationLabels[intent.status];
};
const warningMessages: Record<string, string> = {
  mainnet_currency_metadata_inferred: "主网货币名称与 18 位小数使用推定参数，添加网络前请核对官方资料。",
  public_evidence_uri_unavailable: "证据链接尚未确认可公开访问，共享前请提供评委可访问的链接。",
  gas_estimate_unavailable: "Gas 上限尚未估算，请核对 RPC 状态后重新准备。",
  gas_price_unavailable: "Gas 单价尚未取得，请重新准备交易。",
  balance_unavailable: "钱包余额尚未读取，请重新准备交易。",
  insufficient_balance: "当前余额不足以支付预计费用，请在钱包中核对。",
  wallet_controls_nonce_and_final_fees: "交易序号（nonce）及最终费用由钱包确认。",
  hash_commitment_does_not_certify_facts: "内容哈希用于核对字节是否一致；案件事实仍需核读证据。",
};
const warningText = (code: string): string => Object.prototype.hasOwnProperty.call(warningMessages, code)
  ? warningMessages[code] : "另有一项提示需要核查，请查看交易详情。";
function loadHistory(): BotPublicRecord[] {
  try {
    const stored = localStorage.getItem(historyKey) ?? "null";
    if (stored.length > 100_000) return [];
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object" || !("schema_version" in value) || value.schema_version !== 1 ||
        !("records" in value) || !Array.isArray(value.records)) return [];
    return value.records.slice(0, 50).filter((item): item is BotPublicRecord => {
      if (!item || typeof item !== "object" || ![968, 677].includes(item.chain_id) ||
          !isTransactionHash(item.transaction_hash) || !isBotAction(item.action) ||
          !["submitted", "pending", "failed", "mismatch", "verified"].includes(item.status)) return false;
      return (item.contract_address === undefined || isAddress(item.contract_address)) &&
        (item.case_id === undefined || (typeof item.case_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(item.case_id))) &&
        (item.local_version_id === undefined || (Number.isSafeInteger(item.local_version_id) && item.local_version_id > 0)) &&
        (item.onchain_version_id === undefined || isDecimalId(item.onchain_version_id)) &&
        (item.onchain_review_id === undefined || isDecimalId(item.onchain_review_id));
    }).map((item) => ({
      chain_id: item.chain_id, transaction_hash: item.transaction_hash, action: item.action, status: item.status,
      ...(item.contract_address ? { contract_address: item.contract_address } : {}),
      ...(item.case_id ? { case_id: item.case_id } : {}),
      ...(item.local_version_id ? { local_version_id: item.local_version_id } : {}),
      ...(item.onchain_version_id ? { onchain_version_id: item.onchain_version_id } : {}),
      ...(item.onchain_review_id ? { onchain_review_id: item.onchain_review_id } : {}),
    }));
  } catch { return []; }
}
const message = (error: unknown) => error instanceof Error ? error.message : "操作未完成，请核对钱包与本地 API。";
interface PreparedContext { intent_id: string; request: BotPrepareRequest; response: BotPrepared; generation: number }

export default function BotPanel({ investigation }: { investigation: Investigation | null }) {
  const [networks, setNetworks] = useState<BotNetwork[]>([]);
  const [chainId, setChainId] = useState<BotChainId>(968);
  const [provider, setProvider] = useState<WalletProvider | null>(walletProvider);
  const providerRef = useRef(provider);
  const [account, setAccount] = useState("");
  const [walletChain, setWalletChain] = useState<number | null>(null);
  const [action, setAction] = useState<BotAction>("deploy");
  const [contractAddress, setContractAddress] = useState("");
  const [localVersion, setLocalVersion] = useState(0);
  const [localReview, setLocalReview] = useState(0);
  const [onchainVersion, setOnchainVersion] = useState("");
  const [onchainReview, setOnchainReview] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [prepared, setPrepared] = useState<PreparedContext | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [transactionHash, setTransactionHash] = useState("");
  const [verification, setVerification] = useState<BotVerification | null>(null);
  const [readResult, setReadResult] = useState<BotReadResult | null>(null);
  const [intents, setIntents] = useState<VerificationIntent[]>([]);
  const [selectedIntentId, setSelectedIntentId] = useState("");
  const [verificationIntent, setVerificationIntent] = useState<VerificationIntent | null>(null);
  const verificationIntentRef = useRef<VerificationIntent | null>(null);
  const verificationEpoch = useRef(0);
  const [intentStoreError, setIntentStoreError] = useState("");
  const [records, setRecords] = useState<BotPublicRecord[]>(loadHistory);
  const [walletOutcome, setWalletOutcome] = useState<WalletOutcome | null>(loadWalletOutcome);
  const recordsRef = useRef(records);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const generation = useRef(0);
  const walletEpoch = useRef(0);
  const mounted = useRef(true);
  const contextRef = useRef<PreparedContext | null>(null);
  const submittedContext = useRef<PreparedContext | null>(null);
  const network = networks.find((item) => item.chain_id === chainId);
  const verificationNetwork = networks.find((item) => item.chain_id === verificationIntent?.request.chain_id);
  const versions = investigation?.versions ?? [];
  const reviews = investigation?.reviews ?? [];
  const selectedVersion = versions.find((item) => item.version_id === localVersion);
  const selectedReview = reviews.find((item) => item.review_id === localReview);
  const investigationSignature = `${investigation?.id ?? ""}:${versions.map((item) => `${item.version_id}:${item.content_hash}`).join(",")}:${reviews.map((item) => item.review_id).join(",")}`;
  const invalidate = () => {
    generation.current += 1;
    contextRef.current = null;
    setPrepared(null);
    setAccepted(false);
    setReadResult(null);
    setError("");
    setNotice("");
  };
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void botApi.networks().then((result) => { if (!cancelled) setNetworks(result); }).catch((failure) => { if (!cancelled) setError(message(failure)); });
    void loadVerificationIntents().then((result) => { if (!cancelled) { setIntents(result); setSelectedIntentId(result[0]?.intent_id ?? ""); } })
      .catch((failure) => { if (!cancelled) setIntentStoreError(message(failure)); });
    return () => { cancelled = true; mounted.current = false; generation.current += 1; contextRef.current = null; };
  }, []);
  useEffect(() => {
    invalidate();
    setLocalVersion(versions[0]?.version_id ?? 0);
    setLocalReview(reviews.find((item) => item.review_id && item.version_id === versions[0]?.version_id)?.review_id ?? 0);
    setOnchainVersion("");
    setOnchainReview("");
  }, [investigationSignature]);
  useEffect(() => {
    providerRef.current = provider;
    if (!provider?.on) return;
    const accountsChanged = (value: unknown) => {
      walletEpoch.current += 1;
      invalidate();
      try { setAccount(parseAccounts(value)[0] ?? ""); } catch { setAccount(""); setError("钱包账户变更数据无效，请重新连接。"); }
    };
    const chainChanged = (value: unknown) => {
      walletEpoch.current += 1;
      invalidate();
      try { setWalletChain(parseChainId(value)); } catch { setWalletChain(null); setError("钱包网络变更数据无效，请重新连接。"); }
    };
    const disconnected = () => { walletEpoch.current += 1; invalidate(); setAccount(""); setWalletChain(null); };
    provider.on("accountsChanged", accountsChanged);
    provider.on("chainChanged", chainChanged);
    provider.on("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, [provider]);
  const saveRecord = (entry: BotPublicRecord) => {
    const previous = [...loadHistory(), ...recordsRef.current];
    const next = [entry];
    const seen = new Set([`${entry.chain_id}:${entry.transaction_hash.toLowerCase()}`]);
    for (const item of previous) {
      const key = `${item.chain_id}:${item.transaction_hash.toLowerCase()}`;
      if (!seen.has(key)) { next.push(item); seen.add(key); }
      if (next.length === 50) break;
    }
    recordsRef.current = next;
    try { localStorage.setItem(historyKey, JSON.stringify({ schema_version: 1, records: next })); } catch { /* Current session records remain visible. */ }
    if (mounted.current) setRecords(next);
  };
  const refreshIntents = async () => {
    const result = await loadVerificationIntents();
    if (mounted.current) { setIntents(result); setIntentStoreError(""); }
    return result;
  };
  const selectVerificationIntent = (intent: VerificationIntent) => {
    verificationEpoch.current += 1;
    verificationIntentRef.current = intent;
    setVerificationIntent(intent);
    setSelectedIntentId(intent.intent_id);
    setTransactionHash(intent.transaction_hash ?? "");
    setVerification(null);
  };
  const syncVerificationIntent = (intent: VerificationIntent) => {
    if (mounted.current && verificationIntentRef.current?.intent_id === intent.intent_id) {
      verificationIntentRef.current = intent;
      setVerificationIntent(intent);
    }
  };
  const run = async (label: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError("");
    try { await operation(); } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(""); }
  };
  const stableSnapshot = async (available: WalletProvider): Promise<WalletSnapshot> => {
    const epoch = walletEpoch.current;
    const snapshot = await walletSnapshot(available);
    if (epoch !== walletEpoch.current || providerRef.current !== available || !mounted.current)
      throw new Error("钱包账户或网络已变化，请重新读取连接状态。");
    return snapshot;
  };
  const applySnapshot = (snapshot: WalletSnapshot) => { setAccount(snapshot.account); setWalletChain(snapshot.chainId); };
  const connect = () => run("连接钱包", async () => {
    const available = walletProvider();
    if (!available) throw new Error("请在当前浏览器安装或启用支持 EIP-1193 的钱包，再点击连接。");
    invalidate();
    providerRef.current = available;
    setProvider(available);
    await connectWallet(available);
    applySnapshot(await stableSnapshot(available));
    setNotice("钱包已连接。请核对选定网络后准备交易。");
  });
  const networkAction = (kind: "switch" | "add") => run(kind === "switch" ? "切换网络" : "添加网络", async () => {
    if (!provider || !network) throw new Error("请先连接钱包并取得 BOT 网络配置。");
    invalidate();
    if (kind === "switch") await switchWalletNetwork(provider, network);
    else await addWalletNetwork(provider, network);
    applySnapshot(await stableSnapshot(provider));
    setNotice("钱包网络已读取。请确认网络编号与选定网络一致。");
  });
  const prepare = () => run("准备交易", async () => {
    if (!provider || !network || !account) throw new Error("请先连接钱包并选择 BOT 网络。");
    invalidate();
    const current = generation.current;
    const snapshot = await stableSnapshot(provider);
    if (snapshot.chainId !== chainId || snapshot.account.toLowerCase() !== account.toLowerCase()) throw new Error("钱包账户或网络与页面不一致，请重新连接或切换网络。");
    const body: BotPrepareRequest = { chain_id: chainId, action, account: snapshot.account };
    if (action !== "deploy") {
      if (!isAddress(contractAddress)) throw new Error("请填写当前网络的有效登记合约地址。");
      if (!investigation || !/^[A-Za-z0-9_-]{1,64}$/.test(investigation.id)) throw new Error("请先打开已保存的案件。");
      if (!selectedVersion) throw new Error("请选择已保存的本地版本。");
      body.contract_address = contractAddress;
      body.case_id = investigation.id;
      body.local_version_id = selectedVersion.version_id;
      if (action !== "create_case") {
        if (!isDecimalId(onchainVersion)) throw new Error("请填写 getter 核验的链上版本编号。");
        body.onchain_version_id = onchainVersion;
      }
      if (action === "add_review") {
        if (!selectedReview?.review_id || selectedReview.version_id !== selectedVersion.version_id) throw new Error("请选择绑定该本地版本的已保存复核意见。");
        body.local_review_id = selectedReview.review_id;
      }
      if (evidenceUri.trim()) body.evidence_uri = evidenceUri.trim();
    }
    const response = await botApi.prepare(body);
    if (selectedVersion && action !== "deploy" && response.commitments.content_hash?.replace(/^0x/, "").toLowerCase() !== selectedVersion.content_hash.replace(/^0x/, "").toLowerCase())
      throw new Error("待签内容哈希与选定的本地版本不匹配。");
    if (selectedReview && action === "add_review" && "review_hash" in selectedReview && typeof selectedReview.review_hash === "string" &&
        response.commitments.review_hash?.replace(/^0x/, "").toLowerCase() !== selectedReview.review_hash.replace(/^0x/, "").toLowerCase())
      throw new Error("待签复核哈希与选定的本地记录不匹配。");
    if (generation.current !== current || !mounted.current) throw new Error("准备期间账户、网络或案件已变化，请重新准备。");
    const intent = await saveVerificationIntent(body);
    await refreshIntents();
    if (generation.current !== current || !mounted.current) throw new Error("保存期间账户、网络或案件已变化。只读核验意图已保存，请重新准备签名参数。");
    const context = { intent_id: intent.intent_id, request: intent.request, response, generation: current };
    submittedContext.current = null;
    contextRef.current = context;
    setPrepared(context);
    selectVerificationIntent(intent);
    setNotice("交易参数已准备。核对参数后，可在钱包中审核并签名。");
  });
  const sign = () => run("等待钱包审核", async () => {
    const context = contextRef.current;
    if (!provider || !context || !accepted) throw new Error("请先核对并确认当前交易参数。");
    const storedOutcome = loadWalletOutcome();
    if (walletOutcome || storedOutcome) {
      if (storedOutcome) setWalletOutcome(storedOutcome);
      throw new Error("请先核查上次钱包活动并清除待确认提示，再审核签名。");
    }
    if (submittedContext.current === context) throw new Error("这组参数已取得交易哈希，请先回读对应交易。");
    const durableIntent = await getVerificationIntent(context.intent_id);
    if (JSON.stringify(durableIntent.request) !== JSON.stringify(context.request) || durableIntent.transaction_hash || durableIntent.status !== "ready")
      throw new Error("这份核验意图已关联发送结果或内容有变化，请使用只读回执核验。");
    const currentProvider = provider;
    submittedContext.current = context;
    setAccepted(false);
    const outcome: WalletOutcome = { chain_id: context.request.chain_id, action: context.request.action,
      attempt_id: crypto.randomUUID(), status: "attempting" };
    try {
      localStorage.setItem(outcomeKey, JSON.stringify({ schema_version: 1, ...outcome }));
      if (loadWalletOutcome()?.attempt_id !== outcome.attempt_id) throw new Error("Wallet outcome persistence unavailable");
    } catch { throw new Error("当前浏览器未能保存钱包发送状态，请检查本地存储可用性后重新准备。"); }
    setWalletOutcome(outcome);
    syncVerificationIntent(await updateVerificationIntent(context.intent_id, { status: "uncertain" }));
    await refreshIntents();
    const clearAttempt = () => {
      try { if (loadWalletOutcome()?.attempt_id === outcome.attempt_id) localStorage.removeItem(outcomeKey); } catch { /* Current session state is retained. */ }
      if (mounted.current) setWalletOutcome(loadWalletOutcome());
    };
    let result;
    let knownHash = "";
    try {
      result = await sendWalletTransaction(currentProvider, context.response,
        () => mounted.current && providerRef.current === currentProvider && contextRef.current === context && generation.current === context.generation,
        async (hash) => {
          knownHash = hash;
          saveRecord({ chain_id: context.request.chain_id, transaction_hash: hash, action: context.request.action,
            status: "submitted", contract_address: context.request.contract_address, case_id: context.request.case_id,
            local_version_id: context.request.local_version_id, onchain_version_id: context.request.onchain_version_id });
          if (mounted.current && verificationIntentRef.current?.intent_id === context.intent_id) setTransactionHash(hash);
          const saved = await updateVerificationIntent(context.intent_id, { transaction_hash: hash, status: "submitted" });
          syncVerificationIntent(saved);
          await refreshIntents();
        });
    } catch (failure) {
      const rejected = !!failure && typeof failure === "object" && "code" in failure && failure.code === 4001;
      if (rejected) {
        syncVerificationIntent(await updateVerificationIntent(context.intent_id, { status: "rejected" }));
        await refreshIntents();
        clearAttempt();
        throw new Error("钱包操作已取消。需要再次审核时，请重新准备交易。");
      }
      const unknown: WalletOutcome = { ...outcome, status: "unknown" };
      try { if (loadWalletOutcome()?.attempt_id === outcome.attempt_id) localStorage.setItem(outcomeKey, JSON.stringify({ schema_version: 1, ...unknown })); } catch { /* Keep the warning in the active session. */ }
      if (mounted.current) setWalletOutcome(unknown);
      try { syncVerificationIntent(await updateVerificationIntent(context.intent_id, { status: "uncertain" })); await refreshIntents(); }
      catch (storeFailure) { if (mounted.current) setIntentStoreError(message(storeFailure)); }
      if (knownHash) throw new Error("钱包已返回交易哈希，但只读核验关联保存未完成。请保存当前哈希并核查本机存储，再恢复原核验意图回读。");
      throw new Error("本次钱包操作未取得可核验的交易哈希。请先检查钱包活动与对应网络，取得哈希后手工填写并回读；当前参数已锁定。");
    }
    clearAttempt();
    saveRecord({ chain_id: context.request.chain_id, transaction_hash: result.transactionHash, action: context.request.action,
      status: "submitted", contract_address: context.request.contract_address, case_id: context.request.case_id,
      local_version_id: context.request.local_version_id, onchain_version_id: context.request.onchain_version_id });
    if (!mounted.current) return;
    setTransactionHash(result.transactionHash);
    setAccepted(false);
    setNotice(result.walletChanged
      ? "钱包已返回交易哈希，账户或网络也已变化。请保存哈希并在对应网络回读；当前待签参数已清除。"
      : "钱包已返回交易哈希。点击“读取回执并核验”确认执行结果。");
  });
  const restoreIntent = () => run("恢复只读核验", async () => {
    if (!selectedIntentId) throw new Error("请选择一份本机保存的核验意图。");
    const intent = await getVerificationIntent(selectedIntentId);
    invalidate();
    selectVerificationIntent(intent);
    setNotice("原始只读核验意图已恢复。核验使用所记录的网络和公开发送者，无需连接钱包或准备签名交易。");
  });
  const copyIntent = () => run("复制只读核验意图", async () => {
    const selected = verificationIntentRef.current;
    if (!selected) throw new Error("请先恢复需要复制的核验意图。");
    const original = await getVerificationIntent(selected.intent_id);
    const copied = await saveVerificationIntent(original.request);
    await refreshIntents();
    invalidate();
    selectVerificationIntent(copied);
    setNotice("已建立另一份只读核验意图。可填写另一交易哈希核查，原记录继续保留。");
  });
  const bindHash = () => run("保存只读哈希关联", async () => {
    const selected = verificationIntentRef.current;
    if (!selected || !isTransactionHash(transactionHash)) throw new Error("请先恢复核验意图并填写有效交易哈希。");
    const saved = await updateVerificationIntent(selected.intent_id, { transaction_hash: transactionHash,
      status: selected.status === "ready" ? "submitted" : selected.status });
    await refreshIntents();
    selectVerificationIntent(saved);
    if (contextRef.current?.intent_id === selected.intent_id) { submittedContext.current = contextRef.current; setAccepted(false); }
    setNotice("哈希已与原始公开核验意图关联。请点击回执核验确认实际链上匹配情况。");
  });
  const verify = () => run("读取回执", async () => {
    const selected = verificationIntentRef.current;
    if (!selected || !isTransactionHash(transactionHash)) throw new Error("请恢复原始只读核验意图，并填写交易哈希。");
    const hash = transactionHash.toLowerCase();
    const current = verificationEpoch.current;
    const intent = await getVerificationIntent(selected.intent_id);
    if (intent.binding_sha256 !== selected.binding_sha256 || (intent.transaction_hash && intent.transaction_hash.toLowerCase() !== hash))
      throw new Error("核验意图或已绑定哈希发生变化，请重新恢复对应记录。");
    const result = await botApi.verify(hash, intent.request, 3);
    if (current !== verificationEpoch.current || verificationIntentRef.current?.intent_id !== intent.intent_id || !mounted.current) return;
    setVerification(result);
    const matched = result.status === "verified" || result.status === "failed" ||
      (result.status === "pending" && result.reason === "confirmations_pending");
    if (matched || intent.transaction_hash) {
      const saved = await updateVerificationIntent(intent.intent_id, { transaction_hash: hash, status: result.status });
      if (current !== verificationEpoch.current || verificationIntentRef.current?.intent_id !== intent.intent_id || !mounted.current) return;
      verificationIntentRef.current = saved;
      setVerificationIntent(saved);
      await refreshIntents();
    }
    if (matched && contextRef.current?.intent_id === intent.intent_id) {
      submittedContext.current = contextRef.current;
      setAccepted(false);
    }
    const entry: BotPublicRecord = { chain_id: intent.request.chain_id, transaction_hash: result.transaction_hash, action: intent.request.action,
      status: result.status, contract_address: result.status === "verified" ? result.contract_address ?? intent.request.contract_address : intent.request.contract_address,
      case_id: intent.request.case_id, local_version_id: intent.request.local_version_id, onchain_version_id: result.onchain_ids?.version_id ?? intent.request.onchain_version_id,
      onchain_review_id: result.onchain_ids?.review_id };
    saveRecord(entry);
    if (result.status === "verified" && chainId === intent.request.chain_id &&
        (intent.request.action === "deploy" || investigation?.id === intent.request.case_id)) {
      if (result.contract_address) setContractAddress(result.contract_address);
      if (result.onchain_ids?.version_id) setOnchainVersion(result.onchain_ids.version_id);
      if (result.onchain_ids?.review_id) setOnchainReview(result.onchain_ids.review_id);
    }
    setNotice(`${verificationLabels[result.status]} · ${result.confirmations}/${result.minimum_confirmations} 个确认。`);
  });
  const read = () => run("读取合约", async () => {
    if (!isAddress(contractAddress) || !investigation) throw new Error("请打开案件并填写登记合约地址。");
    if (onchainVersion && !isDecimalId(onchainVersion)) throw new Error("链上版本编号应为正整数。");
    if (onchainReview && !isDecimalId(onchainReview)) throw new Error("链上复核编号应为正整数。");
    const current = generation.current;
    const result = await botApi.read({ chain_id: chainId, contract_address: contractAddress, case_id: investigation.id,
      ...(onchainVersion ? { version_id: onchainVersion } : {}), ...(onchainReview ? { review_id: onchainReview } : {}) });
    if (current !== generation.current || !mounted.current) return;
    setReadResult(result);
    setNotice("已通过只读 getter 取得案件与指定记录。请逐项核对内容哈希及版本关系。");
  });
  const feesReady = !!prepared?.response.transaction.gas && !!prepared.response.transaction.gasPrice && prepared.response.fees.estimated_max_fee_wei !== null;
  const signDisabled = !!busy || !!walletOutcome || !!intentStoreError || !accepted || !feesReady || prepared?.response.fees.sufficient_balance !== true || prepared.response.fees.balance_wei === null || walletChain !== chainId || !account || submittedContext.current === prepared ||
    (!!verificationIntent?.transaction_hash && verificationIntent.intent_id === prepared?.intent_id);
  const change = (operation: () => void) => { invalidate(); operation(); };
  return <section className="panel bot-panel" data-testid="bot-panel" aria-labelledby="bot-heading">
    <div className="bot-heading-row"><div><h2 id="bot-heading">BOT 链上登记</h2><p className="muted">用户钱包签名 · 合约 getter 回读 · 内容承诺与版本关系</p></div>
      <span className="bot-network-badge">{chainId === 968 ? "测试网 · 968" : "主网 · 677"}</span></div>
    <p className="bot-boundary">先在测试网完成部署、v1、复核与 v2 流程，并保存可访问的交易链接，再准备主网 Gas 支持申请。每笔真实交易由你在钱包中审核和签名。</p>
    <div className="bot-grid">
      <div className="subpanel bot-form"><h3>网络与钱包</h3>
        <label>目标网络<select data-testid="bot-network" value={chainId} disabled={!!busy} onChange={(event) => change(() => { setChainId(Number(event.target.value) as BotChainId); setContractAddress(""); setOnchainVersion(""); setOnchainReview(""); })}>
          <option value={968}>BOT 测试网 · 968</option><option value={677}>BOT 主网 · 677</option></select></label>
        <p className="bot-wallet-status">账户：<span className="mono">{account || "尚未连接"}</span><br />钱包网络：{walletChain ?? "尚未读取"}{walletChain !== null && walletChain !== chainId ? " · 请切换到目标网络" : ""}</p>
        <div className="bot-actions"><button type="button" className="button outline" data-testid="bot-connect" disabled={!!busy} onClick={() => void connect()}>连接钱包</button>
          <button type="button" className="button outline" data-testid="bot-switch-network" disabled={!!busy || !account || !network} onClick={() => void networkAction("switch")}>切换到所选网络</button>
          <button type="button" className="button outline" data-testid="bot-add-network" disabled={!!busy || !account || !network} onClick={() => void networkAction("add")}>在钱包中添加网络</button></div>
        {network ? <dl className="bot-parameters"><dt>RPC</dt><dd className="mono">{network.rpc_url}</dd><dt>浏览器</dt><dd><a href={network.explorer_url} target="_blank" rel="noopener noreferrer">{network.explorer_url}</a></dd><dt>原生货币</dt><dd>BOT · 18 位小数</dd></dl> : <p className="muted">等待本地 API 网络配置。</p>}
        {chainId === 677 ? <p className="bot-warning">主网货币符号 BOT 已由官方资料确认；货币名称 BOT 是界面标签，18 位小数依据官方测试网配置及官方客户端 Ether = 10¹⁸ 单位定义推定。添加网络前请核对。</p> : null}
        <p className="muted">主网登记回读使用 getter。当前面板按至少 3 个区块确认核验回执；确认数可能随链上重组变化。</p>
      </div>
      <div className="subpanel bot-form"><h3>登记内容</h3>
        <label>操作<select data-testid="bot-action" value={action} disabled={!!busy} onChange={(event) => change(() => { if (isBotAction(event.target.value)) setAction(event.target.value); })}>{Object.entries(actionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>登记合约<input data-testid="bot-contract" className="mono" placeholder="部署核验通过后自动填入，或填写已有合约" value={contractAddress} disabled={!!busy} maxLength={42} onChange={(event) => change(() => setContractAddress(event.target.value.trim()))} /></label>
        <p className="bot-case-name">当前案件：<strong>{investigation?.title ?? investigation?.id ?? "请先打开已保存的调查"}</strong></p>
        <label>本地版本<select data-testid="bot-local-version" value={localVersion} disabled={!!busy || !versions.length} onChange={(event) => change(() => { setLocalVersion(Number(event.target.value)); setLocalReview(0); })}>
          {!versions.length ? <option value={0}>暂无已保存版本</option> : versions.map((version, index) => <option key={version.version_id} value={version.version_id}>v{index + 1} · 本地编号 {version.version_id}</option>)}</select></label>
        <label>链上版本编号<input data-testid="bot-onchain-version" value={onchainVersion} disabled={!!busy} inputMode="numeric" maxLength={78} placeholder={action === "append_version" ? "同案当前父版本的链上编号" : "回执核验或 getter 取得的编号"} onChange={(event) => change(() => setOnchainVersion(event.target.value.trim()))} /></label>
        <p className="muted">本地版本编号与合约全局版本编号分别记录。复核绑定指定版本；更正追加到同案当前父版本。</p>
        {action === "add_review" ? <label>本地复核<select data-testid="bot-local-review" value={localReview} disabled={!!busy} onChange={(event) => change(() => setLocalReview(Number(event.target.value)))}>
          <option value={0}>选择绑定该版本的复核意见</option>{reviews.filter((review) => review.review_id && review.version_id === localVersion).map((review) => <option key={review.review_id} value={review.review_id}>{review.review_id} · {review.reviewer} · {(review.comment ?? review.decision ?? "").slice(0, 50)}</option>)}</select></label> : null}
        <label>链上复核编号<input value={onchainReview} disabled={!!busy} maxLength={78} inputMode="numeric" placeholder="回读复核时填写" onChange={(event) => change(() => setOnchainReview(event.target.value.trim()))} /></label>
        <label>公开证据 URI<input value={evidenceUri} disabled={!!busy} maxLength={512} placeholder="可选：可共享的证据位置" onChange={(event) => change(() => setEvidenceUri(event.target.value))} /></label>
        <div className="bot-actions"><button type="button" data-testid="bot-prepare" className="button primary" disabled={!!busy || !network || !account || walletChain !== chainId} onClick={() => void prepare()}>准备未签名交易</button>
          <button type="button" data-testid="bot-read" className="button outline" disabled={!!busy || !network || !investigation || !isAddress(contractAddress)} onClick={() => void read()}>读取合约 getter</button></div>
      </div>
    </div>
    {prepared ? <div className="subpanel bot-prepared" data-testid="bot-prepared"><h3>审核当前交易</h3>
      <dl className="bot-parameters"><dt>操作 / 网络</dt><dd>{actionLabels[prepared.request.action]} · {prepared.response.network.name} ({prepared.request.chain_id})</dd><dt>预计费用上限</dt><dd>{formatBot(prepared.response.fees.estimated_max_fee_wei)}</dd><dt>余额</dt><dd>{formatBot(prepared.response.fees.balance_wei)}{prepared.response.fees.sufficient_balance === false ? " · 余额不足" : ""}</dd><dt>Gas 上限 / 单价</dt><dd>{prepared.response.fees.gas_limit ?? "待取得"} / {prepared.response.fees.gas_price_wei ?? "待取得"} wei</dd></dl>
      <p className="muted">费用上限按当前 Gas 参数估算；实际费用与发送参数以钱包最终审核及链上回执为准。</p>
      {prepared.request.chain_id === 677 ? <p className="bot-warning">这是主网真实交易，会消耗 BOT。请核对主网合约、钱包账户与预计费用。</p> : null}
      {prepared.response.fees.balance_wei === null ? <p className="bot-warning">当前余额读取尚未完成，请核对 RPC 状态并重新准备交易。</p> : null}
      {!feesReady ? <p className="bot-warning">费用估算尚未完整取得，请核对 RPC 状态后重新准备交易。</p> : null}
      {prepared.response.warnings.length ? <ul className="bot-warnings">{[...new Set(prepared.response.warnings.map(warningText))].map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      <label className="bot-json-label">完整未签名交易参数<textarea className="mono" aria-label="完整未签名交易参数" readOnly rows={8} value={JSON.stringify(prepared.response.transaction, null, 2)} /></label>
      <details><summary>内容承诺、合约构建与提示详情</summary><pre className="mono">{JSON.stringify({ commitments: prepared.response.commitments, artifact: prepared.response.artifact, warning_codes: prepared.response.warnings }, null, 2)}</pre></details>
      <label className="bot-consent"><input type="checkbox" checked={accepted} disabled={!!busy} onChange={(event) => setAccepted(event.target.checked)} /><span className="bot-consent-text">已核对网络、账户、合约、内容承诺和预计费用。</span></label>
      <button type="button" className="button primary" data-testid="bot-sign" disabled={signDisabled} onClick={() => void sign()}>在钱包中审核并签名</button>
    </div> : null}
    <div className="subpanel bot-receipt"><h3>交易回读</h3>
      <label className="bot-json-label">本机核验意图<select data-testid="bot-intent-select" value={selectedIntentId} disabled={!!busy || !intents.length} onChange={(event) => setSelectedIntentId(event.target.value)}>
        <option value="">选择保存的公开核验参数</option>{intents.map((intent) => <option value={intent.intent_id} key={intent.intent_id}>{actionLabels[intent.request.action]} · {intent.request.chain_id} · {intentStatusLabel(intent)} · {intent.transaction_hash?.slice(0, 12) ?? intent.intent_id.slice(0, 8)}</option>)}
      </select></label>
      <button type="button" className="button outline" data-testid="bot-intent-restore" disabled={!!busy || !selectedIntentId} onClick={() => void restoreIntent()}>恢复只读核验意图</button>
      {verificationIntent ? <div data-testid="bot-verification-intent"><p className="muted">当前只读核验使用以下原始公开参数，与钱包当前账户和目标网络分别展示。恢复只读记录后，可直接读取回执。</p>
        <dl className="bot-parameters"><dt>原网络 / 操作</dt><dd>{verificationIntent.request.chain_id} · {actionLabels[verificationIntent.request.action]}</dd><dt>原发送者</dt><dd className="mono">{verificationIntent.request.account}</dd><dt>原合约</dt><dd className="mono">{verificationIntent.request.contract_address ?? "创建新合约"}</dd><dt>案件 / 本地版本</dt><dd>{verificationIntent.request.case_id ?? "—"} / {verificationIntent.request.local_version_id ?? "—"}</dd><dt>链上版本 / 复核</dt><dd>{verificationIntent.request.onchain_version_id ?? "—"} / 本地复核 {verificationIntent.request.local_review_id ?? "—"}</dd><dt>绑定交易哈希</dt><dd className="mono">{verificationIntent.transaction_hash ?? "尚未关联"}</dd></dl>
        <details><summary>只读核验意图详情</summary><pre className="mono">{JSON.stringify(verificationIntent, null, 2)}</pre></details>
        <button type="button" className="button outline" data-testid="bot-intent-copy" disabled={!!busy} onClick={() => void copyIntent()}>复制为另一份只读核验意图</button>
      </div> : <p className="muted">刷新后选择原核验意图即可回读，无需重新准备已执行的交易。</p>}
      <label className="bot-json-label">交易哈希<input data-testid="bot-transaction-hash" className="mono" value={transactionHash} disabled={!!busy} readOnly={!!verificationIntent?.transaction_hash} maxLength={66} placeholder="0x… 钱包返回的 32 字节哈希" onChange={(event) => { verificationEpoch.current += 1; setTransactionHash(event.target.value.trim()); setVerification(null); }} /></label>
      <button type="button" className="button outline" data-testid="bot-bind-hash" disabled={!!busy || !verificationIntent || !!verificationIntent.transaction_hash || !isTransactionHash(transactionHash)} onClick={() => void bindHash()}>保存输入哈希的只读关联</button>
      {walletOutcome ? <div className="bot-warning" data-testid="bot-wallet-outcome-warning" role="alert">
        <p>{walletOutcome.status === "attempting" && busy === "等待钱包审核"
          ? `钱包审核正在进行：${actionLabels[walletOutcome.action]} · 网络 ${walletOutcome.chain_id}。收起面板会保留当前发送状态，请等待钱包结果。`
          : `上次钱包发送结果需要核查：${actionLabels[walletOutcome.action]} · 网络 ${walletOutcome.chain_id}。请先检查钱包活动与该网络的交易记录，取得哈希后回读，再决定是否重新准备。重新准备参数会保留这条提示。`}</p>
        <button type="button" className="button outline" disabled={!!busy} data-testid="bot-wallet-outcome-ack" onClick={() => {
          try { localStorage.removeItem(outcomeKey); } catch { /* Current session acknowledgement still applies. */ }
          setWalletOutcome(null);
        }}>已核查钱包活动，清除提示</button>
      </div> : null}
      <button type="button" className="button outline" data-testid="bot-verify" disabled={!!busy || !verificationIntent || !isTransactionHash(transactionHash)} onClick={() => void verify()}>读取回执并核验</button>
      {transactionHash && verificationNetwork && isTransactionHash(transactionHash) ? <a className="text-button bot-explorer-link" href={explorerLink(verificationNetwork, "tx", transactionHash)} target="_blank" rel="noopener noreferrer">在原核验网络查看交易</a> : null}
      {verification ? <div className={`bot-verification bot-${verification.status}`} data-testid="bot-verification"><strong>{verificationLabels[verification.status]}</strong><p>{verification.reason ?? `${verification.confirmations}/${verification.minimum_confirmations} 个确认`}</p><pre className="mono">{JSON.stringify({ contract_address: verification.contract_address, onchain_ids: verification.onchain_ids, getter_state: verification.getter_state }, null, 2)}</pre></div> : null}
    </div>
    {readResult ? <details className="subpanel bot-read-result" open data-testid="bot-read-result"><summary>只读 getter 结果</summary><pre className="mono">{JSON.stringify(readResult, null, 2)}</pre></details> : null}
    {busy ? <p className="inline-notice" role="status">{busy}…</p> : null}
    {notice ? <p className="inline-notice" role="status">{notice}</p> : null}
    {error ? <p className="error-banner" role="alert">{error}</p> : null}
    {intentStoreError ? <p className="error-banner" role="alert" data-testid="bot-intent-store-error">{intentStoreError}</p> : null}
    {records.length ? <details className="bot-records"><summary>本机公开交易记录（{records.length}）</summary><ul>{records.map((entry) => {
      const entryNetwork = networks.find((item) => item.chain_id === entry.chain_id);
      return <li key={`${entry.chain_id}:${entry.transaction_hash}`}><strong>{actionLabels[entry.action]} · {entry.chain_id} · {entry.status === "submitted" ? "钱包已返回哈希" : verificationLabels[entry.status]}</strong><br />{entryNetwork ? <a className="mono" href={explorerLink(entryNetwork, "tx", entry.transaction_hash)} target="_blank" rel="noopener noreferrer">{entry.transaction_hash}</a> : <span className="mono">{entry.transaction_hash}</span>}<br />本地版本 {entry.local_version_id ?? "—"} → 链上版本 {entry.onchain_version_id ?? "—"}{entry.onchain_review_id ? ` · 链上复核 ${entry.onchain_review_id}` : ""}</li>;
    })}</ul></details> : null}
    <p className="page-note">链上哈希与版本关系用于追溯内容，事实结论仍需核读证据。本机保存公开核验参数、账户地址与哈希关联；签名交易参数和费用仅保留在页面内存。同一操作者控制的多个钱包角色应如实披露。</p>
  </section>;
}
