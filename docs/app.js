import { verifyBundle } from './bundle.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { version: 2, current: null, bundles: new Map(), selectionEpoch: 0, importEpoch: 0, evidenceTab: 'transfer' };
const fixtureHashes = {
  1: { manifest: '51c6cc079efe6dadaecbd439c7779f0d1c217186de660623c4ea9dca6142cf57', archive: 'b06a69d723b91b83c8ec47e51e343f0dbb778782cab8c05d170ea4b4664d1a09' },
  2: { manifest: '02267fad63c5c669c5767b936cc21c6745c5d2e3f3fa692a5528a99359d34347', archive: '613bf5662f0735b06f4e74bee1314e67fa144919e0b0ab53fb7268c1fea05d65' }
};
const statusLabels = { supported: '支持', refuted: '反证', unknown: '未知' };
const coverageLabels = { complete: '采集完成', empty: '成功 · 空结果', partial: '部分完成', error: '读取错误' };
const guidance = {
  complete: '完成：计划中的查询均成功返回。覆盖率限定于请求的地址、代币、窗口和提供方返回的数据；它不是全链事实认证。',
  empty: '空结果：查询成功，但指定范围内没有符合条件的 Transfer。它与“读取失败”含义不同。',
  partial: '部分完成：已有可用证据，同时仍有未完成或失败的查询。报告需要保留缺口，并限定结论范围。',
  error: '错误：读取未能提供可用结果。此状态不能解释成“没有事件”，应保留错误与待核对事项。'
};
const candidateCopy = {
  confirmed_execution: ['指定 Transfer 已成功执行', '回执状态与交易标识支持已执行的转账事实。'],
  supply_decrease: ['历史 totalSupply() 在此事件前后减少', '包内两次历史 getter 返回值一致；请分别核对读数与区块定位。'],
  event_explanation: ['这笔转账的完整因果解释', '治理提案提供公开背景。具体因果、账户控制状态与更广范围风险仍需复核。']
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function route() {
  const name = location.hash.slice(1);
  const selected = ['case', 'review', 'verify'].includes(name) ? name : 'case';
  $$('[data-screen]').forEach(node => { node.hidden = node.dataset.screen !== selected; });
  $$('[data-route]').forEach(node => {
    if (node.dataset.route === selected) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  document.title = `ClueTide · ${{ case: '让解释回到证据', review: '版本复核', verify: '验证证据包' }[selected]}`;
}

function definition(container, title, value, monospace = false) {
  const list = element('dl', undefined, 'evidence-line');
  list.append(element('dt', title), element('dd', String(value ?? '未提供'), monospace ? 'full-hash' : undefined));
  container.append(list);
}

function showEvidence(tab) {
  state.evidenceTab = tab;
  $$('[data-evidence]').forEach(button => { button.setAttribute('aria-selected', String(button.dataset.evidence === tab)); });
  const panel = $('#evidence-panel');
  panel.replaceChildren();
  panel.setAttribute('aria-labelledby', `tab-${tab}`);
  if (!state.current) return;
  const { evidence, report } = state.current;
  const transfer = evidence.transfers[0];
  const info = element('div', undefined, 'evidence-insight');
  if (tab === 'transfer') {
    info.append(element('p', 'UNI Transfer 日志记录转出与收款地址。原始金额按 uint256 十进制字符串展示，避免浮点精度损失。'));
    panel.append(info);
    if (!transfer) { panel.append(element('p', '此证据包没有 Transfer 记录。')); return; }
    definition(panel, '交易哈希', transfer.transaction_hash, true);
    definition(panel, '转出地址 · Timelock', transfer.from_address, true);
    definition(panel, '收款地址', transfer.to_address, true);
    definition(panel, '原始金额 · 18 位小数', transfer.value_raw, true);
    definition(panel, '事件定位', `区块 ${transfer.block_number} · logIndex ${transfer.log_index}`);
    definition(panel, 'Token 合约', transfer.token_address, true);
  } else if (tab === 'receipt') {
    const receipt = report.agent?.evidence?.find(item => item.kind === 'receipt');
    info.append(element('p', receipt?.payload?.status === '0x1' ? '保存的回执状态为成功。执行状态与交易内容须结合检查。' : '回执执行状态以证据包原始读数为准。'));
    panel.append(info);
    definition(panel, '回执状态', receipt?.payload?.status ?? '未提供');
    definition(panel, '交易哈希', receipt?.payload?.transactionHash, true);
    definition(panel, '调用目标 · GovernorBravo', receipt?.payload?.to, true);
    definition(panel, '所在区块哈希', receipt?.payload?.blockHash, true);
    const tx = report.agent?.evidence?.find(item => item.kind === 'transaction');
    definition(panel, '交易输入', tx?.payload?.input, true);
    panel.append(element('p', '输入中的方法选择器与参数指向 execute(93)。展示的是保存的公开快照，当前页面不会查询实时链状态。', 'evidence-panel-note'));
  } else if (tab === 'governance') {
    info.append(element('p', '提案 93 的行动清单包含一亿 UNI 转入 dead 地址。治理材料用于理解背景，回执用于定位执行事实。'));
    panel.append(info);
    definition(panel, '提案编号', '93');
    definition(panel, '公开提案', 'UNIfication · Proposal Spec / first UNI.transfer action');
    const supply = report.agent?.evidence?.filter(item => item.kind === 'token_state') ?? [];
    for (const item of supply) {
      const payload = item.payload;
      definition(panel, '历史 token_state 证据', item.evidence_id);
      const pre = element('pre', JSON.stringify(payload, null, 2), 'json-content');
      panel.append(pre);
    }
    panel.append(element('p', '项目摘要保留原始来源链接；提案页面显示的日期与链上区块时间分别定位。', 'evidence-panel-note'));
  } else {
    const coverage = evidence.coverage;
    info.append(element('p', `状态：${coverageLabels[coverage.status]}。范围内完成 ${coverage.completed_queries}/${coverage.planned_queries} 项计划查询。`));
    panel.append(info);
    definition(panel, '包含首尾区块的窗口', `${coverage.requested_from_block}–${coverage.requested_to_block}`);
    definition(panel, '去重后的目标地址 Transfer', `${evidence.transfers.length} 条`);
    definition(panel, '出账与入账查询', (coverage.queries ?? []).map(query => `${query.direction === 'outgoing' ? '出账' : '入账'}：返回 ${query.returned_logs} 条，接受 ${query.accepted_logs} 条`).join('；'));
    definition(panel, '保存的 finalized 锚点', evidence.finalized_anchor?.number);
    definition(panel, '缺口 / 问题', coverage.issues?.length ? coverage.issues.join('；') : '计划查询记录未列出缺口');
    panel.append(element('p', 'finalized 标记来自保存的提供方响应；本包不包含独立共识证明。21 个区块的范围不代表全合约或全链调查。', 'evidence-panel-note'));
  }
}

function showAssessments(bundle) {
  const container = $('#assessments');
  container.replaceChildren();
  for (const item of bundle.report.conclusion.assessments) {
    const card = element('section', undefined, `assessment ${item.status}`);
    const header = element('div', undefined, 'assessment-heading');
    const [title, explanation] = candidateCopy[item.explanation_id] ?? [item.explanation, item.unknowns?.join('；') || item.checks?.join('；') || '请查看报告中的证据引用。'];
    header.append(element('h3', title), element('span', statusLabels[item.status], 'assessment-status'));
    card.append(header, element('p', explanation));
    const references = [...item.support_evidence_ids.map(id => ({ id, label: '支持证据' })), ...item.counter_evidence_ids.map(id => ({ id, label: '反证依据' }))];
    if (references.length) {
      const citations = element('div', undefined, 'citation-list');
      references.forEach(({ id, label }, index) => {
        const button = element('button', `${label} ${index + 1}`, 'citation');
        button.type = 'button';
        button.title = id;
        button.addEventListener('click', () => {
          const kind = bundle.report.agent?.evidence?.find(evidence => evidence.evidence_id === id)?.kind;
          showEvidence(kind === 'receipt' || kind === 'transaction' ? 'receipt' : kind === 'governance_source' || kind === 'token_state' ? 'governance' : 'transfer');
          $('#evidence-panel').focus({ preventScroll: true });
          if (matchMedia('(max-width: 850px)').matches) $('#evidence-title').scrollIntoView({ block: 'start', behavior: 'auto' });
        });
        citations.append(button);
      });
      card.append(citations);
    }
    container.append(card);
  }
}

function showReview(bundle) {
  const container = $('#review-version');
  container.replaceChildren();
  const meta = element('div', undefined, 'version-meta');
  meta.append(element('span', `报告 v${state.version}`), element('span', '发布角色：示例作者'));
  container.append(meta);
  const section = element('div', undefined, 'version-detail');
  section.append(element('h3', state.version === 1 ? '固定转账事实与治理上下文' : '明确转账与供给量主张的边界'));
  section.append(element('p', state.version === 1 ? '初始合成报告引用了回执、交易与提案背景。后续复核将在金额描述中明确 totalSupply 主张的证据边界。' : '示例复核流程指出：一笔转账与 totalSupply() 的变化属于不同主张。示例作者在 v2 应用更正，并保留 v1 的精确 manifest 摘要。'));
  section.append(element('h3', '报告中的金额主张'));
  const claim = bundle.report.conclusion.claims.find(item => item.text.includes('raw token units'));
  section.append(element('p', claim?.text ?? bundle.report.conclusion.summary));
  const hashes = element('dl', undefined, 'hash-list');
  hashes.append(element('dt', '当前 manifest SHA-256'), element('dd', bundle.manifestHash, 'full-hash'));
  hashes.append(element('dt', '父版本 manifest SHA-256'), element('dd', bundle.report.parent_manifest_hash || 'v1 为初始版本', 'full-hash'));
  section.append(hashes);
  if (state.version === 2) {
    const linked = bundle.report.parent_manifest_hash === state.bundles.get(1)?.manifestHash;
    section.append(element('p', linked ? '父版本摘要与已验证的 v1 证据包一致。' : '父版本摘要尚未与 v1 证据包匹配。', linked ? undefined : 'inline-error'));
  }
  container.append(section);
}

async function selectVersion(version) {
  const epoch = ++state.selectionEpoch;
  const status = $('#load-status');
  status.hidden = false;
  status.className = 'status-panel';
  status.textContent = `正在校验 v${version} 证据包…`;
  $('#download-bundle').disabled = true;
  $('#download-manifest').disabled = true;
  try {
    let bundle = state.bundles.get(version);
    if (!bundle) {
      const response = await fetch(new URL(`./assets/uniswap93-synthetic-v${version}.zip`, import.meta.url), { credentials: 'omit', cache: 'no-cache', redirect: 'error' });
      if (!response.ok) throw new Error('示例文件读取失败，请稍后刷新或使用本地启动方式。');
      const bytes = new Uint8Array(await response.arrayBuffer());
      bundle = await verifyBundle(bytes);
      if (bundle.archiveHash !== fixtureHashes[version].archive || bundle.manifestHash !== fixtureHashes[version].manifest) throw new Error('示例文件与固定发布摘要不一致。');
      if (bundle.report.synthetic_fixture?.mode !== 'synthetic' || bundle.report.agent?.synthetic !== true || bundle.report.synthetic_fixture.model_requests !== 0 || bundle.report.synthetic_fixture.transactions_signed_or_broadcast !== 0 || bundle.report.case_id !== 'uniswap93-synthetic' || bundle.report.revision !== version) throw new Error('示例包的合成标记或版本不一致。');
      state.bundles.set(version, bundle);
    }
    if (epoch !== state.selectionEpoch) return;
    state.version = version;
    state.current = bundle;
    $('#case-body').hidden = false;
    status.hidden = true;
    $('#active-version').textContent = `v${version} · 合成示例`;
    $('#report-summary').textContent = '保存的回执记录这笔 UNI 转账已成功执行。治理提案提供公开背景；这份合成报告仍将完整因果解释标为未知，并逐项限定供给量判断。';
    $('#coverage-status').textContent = coverageLabels[bundle.evidence.coverage.status];
    $('#manifest-hash').textContent = bundle.manifestHash;
    $('#archive-hash').textContent = bundle.archiveHash;
    $('#download-version').textContent = `v${version} · 5 个文件`;
    $('#download-bundle').disabled = false;
    $('#download-manifest').disabled = false;
    $$('[data-version]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.version) === version)));
    showAssessments(bundle);
    showEvidence(state.evidenceTab);
    showReview(bundle);
  } catch (error) {
    if (epoch !== state.selectionEpoch) return;
    state.current = null;
    $('#case-body').hidden = true;
    $('#active-version').textContent = '读取失败';
    $('#manifest-hash').textContent = '证据文件读取失败';
    $('#archive-hash').textContent = '证据文件读取失败';
    $('#download-version').textContent = '读取失败';
    $('#review-version').replaceChildren(element('p', '示例证据文件读取失败。请刷新页面重试；本地文件导入仍可使用。', 'inline-error'));
    status.className = 'status-panel error';
    status.textContent = error instanceof Error ? error.message : '证据包校验失败。';
  }
}

function download(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const anchor = element('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(file) {
  const epoch = ++state.importEpoch;
  const status = $('#import-result');
  const details = $('#import-details');
  details.hidden = true;
  details.replaceChildren();
  status.className = 'import-result neutral';
  status.replaceChildren(element('strong', '正在校验…'), element('p', '检查 ZIP 目录、内容摘要、金额与引用结构。'));
  try {
    if (!file || !file.name.toLowerCase().endsWith('.zip') || file.size > 16 * 1024 * 1024 || file.size < 22) throw new Error('请选择 16 MiB 以内的完整 ZIP 文件。');
    const bundle = await verifyBundle(new Uint8Array(await file.arrayBuffer()));
    if (epoch !== state.importEpoch) return;
    status.className = 'import-result success';
    status.replaceChildren(element('strong', '完整性校验通过'), element('p', `4 个内容文件的 SHA-256 与 manifest 一致。报告版本：${bundle.report.revision ?? '未提供'}。`));
    details.hidden = false;
    details.className = 'import-details';
    const hashes = element('dl', undefined, 'hash-list');
    hashes.append(element('dt', '导入文件的 manifest SHA-256'), element('dd', bundle.manifestHash, 'full-hash'));
    hashes.append(element('dt', '数据类型'), element('dd', bundle.report.synthetic_fixture?.mode === 'synthetic' ? '公开快照 + 合成报告' : '用户提供的证据包；请自行核对来源'));
    hashes.append(element('dt', '采集覆盖状态'), element('dd', coverageLabels[bundle.evidence.coverage.status]));
    hashes.append(element('dt', 'Transfer 数量'), element('dd', String(bundle.evidence.transfers.length)));
    details.append(hashes, element('p', '完整性通过确认了文件字节关系；本次导入没有验证事实真实性、来源认证或复核者独立性。'));
    details.append(element('h3', '导入的报告摘要'), element('p', bundle.report.conclusion.summary));
    const candidates = element('div', undefined, 'assessments');
    for (const assessment of bundle.report.conclusion.assessments) {
      const card = element('section', undefined, `assessment ${assessment.status}`);
      const heading = element('div', undefined, 'assessment-heading');
      heading.append(element('h3', assessment.explanation), element('span', statusLabels[assessment.status], 'assessment-status'));
      card.append(heading);
      if (assessment.unknowns?.length) card.append(element('p', assessment.unknowns.join('；')));
      const references = [...assessment.support_evidence_ids, ...assessment.counter_evidence_ids];
      if (references.length) card.append(element('p', `证据引用：${references.join('；')}`));
      candidates.append(card);
    }
    details.append(candidates);
    for (const [title, value] of [['查看报告 JSON', bundle.report], ['查看原始数据 JSON', bundle.raw]]) {
      const disclosure = element('details');
      disclosure.append(element('summary', title), element('pre', JSON.stringify(value, null, 2), 'json-content'));
      details.append(disclosure);
    }
  } catch (error) {
    if (epoch !== state.importEpoch) return;
    details.hidden = true;
    details.replaceChildren();
    status.className = 'import-result error';
    status.replaceChildren(element('strong', '导入已拒绝'), element('p', error instanceof Error ? error.message : '文件无法通过完整性校验。'));
  }
}

window.addEventListener('hashchange', route);
route();
$$('[data-version]').forEach(button => button.addEventListener('click', () => selectVersion(Number(button.dataset.version))));
$$('[data-evidence]').forEach(button => button.addEventListener('click', () => showEvidence(button.dataset.evidence)));
$('#evidence-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = $$('[data-evidence]');
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
  showEvidence(buttons[next].dataset.evidence);
});
$$('[data-state]').forEach(button => button.addEventListener('click', () => {
  $$('[data-state]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  $('#state-explanation').textContent = guidance[button.dataset.state];
}));
$('#state-explanation').textContent = guidance.complete;
$('#download-bundle').addEventListener('click', () => { if (state.current) download(state.current.bytes, `cluetide-uniswap93-synthetic-v${state.version}.zip`, 'application/zip'); });
$('#download-manifest').addEventListener('click', () => { if (state.current) download(state.current.payloads.get('manifest.json'), `cluetide-uniswap93-v${state.version}-manifest.json`, 'application/json'); });
$('#bundle-file').addEventListener('change', event => { if (event.target.files?.[0]) importFile(event.target.files[0]); });
// Verify both versions so the parent commitment is checked against actual bytes.
await selectVersion(1);
await selectVersion(2);
