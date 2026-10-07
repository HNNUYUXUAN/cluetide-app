"""Build deterministic synthetic reports from the bundled public RPC snapshot.

This generator uses only local files and deterministic adapter reads. Report
interpretations are authored fixtures, and the model request count is zero.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from cluetide.adapters import CachedRpc, InvestigationTools, load_case
from cluetide.agent import Conclusion, validate_assessment_bindings
from cluetide.bundles import export_bundle, import_bundle, manifest_sha256
from cluetide.citation_validation import citation_validation
from cluetide.collector import collect_transfers
from cluetide.investigation_scope import select_investigation_transaction
from cluetide.report_quality import deterministic_transfer_facts, report_quality
from cluetide.schemas import EvidenceSet, InvestigationRequest


FIXTURE_SCHEMA = "cluetide-synthetic-fixture/v1"
CASE_ID = "uniswap93-synthetic"
FIXTURE_DIRECTORY = ROOT / "data" / "fixtures"


def fixture_markdown(report: dict) -> str:
    conclusion = report["conclusion"]
    lines = ["# Uniswap 93 synthetic demonstration", "",
             f"Revision: {report['revision']}", "",
             "This report is a deterministic local fixture built from the bundled public RPC snapshot.",
             "Its interpretation is synthetic. Model requests, network reads, signing and broadcasts during generation: 0.",
             "", conclusion["summary"], "", "## Evidence claims", ""]
    for claim in conclusion["claims"]:
        lines.extend(["- " + claim["text"], "  Evidence: " + ", ".join(claim["evidence_ids"])])
    lines.extend(["", "## Explanation assessments", ""])
    for item in conclusion.get("assessments", []):
        lines.extend([f"- {item['explanation_id']}: {item['explanation']} ({item['status']})",
                      "  Supporting evidence: " + ", ".join(item["support_evidence_ids"]),
                      "  Counter evidence: " + ", ".join(item["counter_evidence_ids"]),
                      "  Unknowns: " + "; ".join(item["unknowns"]),
                      "  Checks: " + "; ".join(item["checks"])])
    lines.extend(["", "## Limits", ""])
    lines.extend("- " + value for value in conclusion["limitations"])
    if report["corrections"]:
        lines.extend(["", "## Local correction", ""])
        lines.extend("- " + item["text"] for item in report["corrections"])
    return "\n".join(lines) + "\n"


async def fixture_documents(root: Path = ROOT) -> tuple[dict, dict]:
    case_directory = root / "data" / "cases" / "uniswap93"
    snapshot, sources = load_case(case_directory)
    scope = snapshot["request"]
    request = InvestigationRequest(address=scope["subject_address"], token_address=scope["token_address"],
                                   from_block=scope["start_block"], to_block=scope["end_block"])
    rpc = CachedRpc(snapshot)
    evidence = await collect_transfers(request, rpc)
    if evidence.coverage.status != "complete" or len(evidence.transfers) != 1:
        raise ValueError("The synthetic fixture requires one completely collected transfer.")
    evidence.collected_at = snapshot["recorded_at_utc"]
    evidence.sources = copy.deepcopy(sources)
    transfer = evidence.transfers[0]
    tools = InvestigationTools(rpc, request, sources, expected_transaction_blocks={
        transfer.transaction_hash: {"block_number": transfer.block_number, "block_hash": transfer.block_hash}})
    receipt = await tools.get_receipt(transfer.transaction_hash)
    transaction = await tools.get_transaction(transfer.transaction_hash)
    source = await tools.get_governance_source(sources[0]["source_id"])
    states = snapshot["token_state"]
    before = await tools.get_token_state(request.token_address, states["totalSupply_before_block_number"])
    after = await tools.get_token_state(request.token_address, states["totalSupply_after_block_number"])
    if before["payload"]["total_supply_raw"] != after["payload"]["total_supply_raw"]:
        raise ValueError("The synthetic supply comparison requires equal captured getter values.")
    provenance = {
        "schema_version": FIXTURE_SCHEMA, "mode": "synthetic", "generator": "scripts/build_public_fixtures.py",
        "interpretation_source": "deterministic_local_fixture", "model_requests": 0,
        "network_reads": 0, "transactions_signed_or_broadcast": 0,
        "public_sources": [{"path": str(path.relative_to(root)).replace("\\", "/"),
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                           for path in (case_directory / "rpc.json", case_directory / "sources.json")],
        "scope": "RPC observations retain the bundled public snapshot data. The report interpretation is synthetic.",
    }
    evidence.raw.update(capture_mode="public_cache", agent_rpc_observations=tools.observations,
                        synthetic_fixture=provenance)
    conclusion = {
        "summary": "The bundled snapshot records one outgoing UNI transfer to the dead address. This synthetic report leaves its causal explanation for review.",
        "classification": "unresolved",
        "claims": [
            {"text": "The local adapter returned a confirmed receipt and transaction for the selected transfer.",
             "evidence_ids": [receipt["evidence_id"], transaction["evidence_id"]], "interpretation": False},
            {"text": f"One outgoing Transfer records {transfer.value_raw} raw token units to {transfer.to_address}.",
             "evidence_ids": [receipt["evidence_id"]], "interpretation": False},
            {"text": "The bundled project summary points to Uniswap proposal 93 as governance context.",
             "evidence_ids": [source["evidence_id"]], "interpretation": False},
            {"text": "The selected receipt has a successful execution status in the public snapshot.",
             "evidence_ids": [receipt["evidence_id"]], "interpretation": False},
        ],
        "limitations": ["The explanation is a deterministic synthetic fixture, with zero model requests.",
                        "RPC data and project source summaries require independent source review.",
                        "A dead-address transfer alone does not establish a totalSupply decrease.",
                        "SHA-256 commitments verify artifact bytes, not factual truth.",
                        "Local review roles are controlled demonstration roles."],
        "assessments": [
            {"explanation_id": "confirmed_execution", "explanation": "The selected transaction executed successfully",
             "status": "supported", "support_evidence_ids": [receipt["evidence_id"], transaction["evidence_id"]],
             "counter_evidence_ids": [], "unknowns": [],
             "checks": ["Compare the confirmed receipt status and transaction identity in the captured snapshot."]},
            {"explanation_id": "supply_decrease", "explanation": "A net decrease in the totalSupply getter across the captured block pair",
             "status": "refuted", "support_evidence_ids": [],
             "counter_evidence_ids": [before["evidence_id"], after["evidence_id"]], "unknowns": [],
             "checks": ["Compare every raw integer digit of the two historical totalSupply getter observations."]},
            {"explanation_id": "event_explanation", "explanation": "Cause of the selected transfer",
             "status": "unknown", "support_evidence_ids": [], "counter_evidence_ids": [],
             "unknowns": ["The synthetic fixture does not establish the event's causal explanation."],
             "checks": ["Read the captured receipt, transaction and attributed context summary."]},
        ],
    }
    agent_evidence = [receipt, transaction, source, before, after]
    validate_assessment_bindings(Conclusion.model_validate(conclusion, strict=True), agent_evidence)
    agent = {"status": "completed", "report": copy.deepcopy(conclusion), "evidence": agent_evidence,
             "model_requests": 0, "tool_attempts": 5, "model_names": [], "stop_reason": None,
             "trace": [{"event": "synthetic_fixture", "model_requests": 0}],
             "execution_source": "deterministic_local_fixture", "synthetic": True}
    _, investigation_scope = select_investigation_transaction(evidence.model_dump(mode="json"))
    investigation_scope["investigated_transaction_hash"] = transfer.transaction_hash
    investigation_scope["uninvestigated_transaction_hashes"] = []
    report = {"schema_version": "cluetide-report/v1", "case_id": CASE_ID, "revision": 1,
              "coverage": evidence.coverage.model_dump(mode="json"), "conclusion": conclusion,
              "conclusion_source": "deterministic_local_fixture", "agent": agent,
              "investigation_scope": investigation_scope, "execution_status": "completed", "stop_reason": None,
              "corrections": [], "parent_manifest_hash": None, "review_records": [],
              "review_status": "awaiting_human_review", "requested_agent_mode": "offline",
              "execution_mode": "Synthetic local fixture; zero model requests", "synthetic_fixture": copy.deepcopy(provenance)}
    document = evidence.model_dump(mode="json")
    report["transfer_facts"] = deterministic_transfer_facts(document)
    report["quality_validation"] = report_quality(report, document)
    report["citation_validation"] = citation_validation(report, document)
    if report["citation_validation"]["status"] != "valid":
        raise ValueError("Generated citation issue codes: " + ", ".join(
            issue["code"] for issue in report["citation_validation"]["issues"]))
    return document, report


def build_fixtures(output_directory: Path = FIXTURE_DIRECTORY, *, root: Path = ROOT) -> list[dict]:
    evidence, report = asyncio.run(fixture_documents(root))
    results = []
    for revision in (1, 2):
        if revision == 2:
            report = copy.deepcopy(report)
            report.update(revision=2, parent_manifest_hash=results[0]["manifest_hash"],
                          review_status="revised_by_local_author",
                          corrections=[{"text": "Clarify that the transfer evidence alone establishes no totalSupply change.",
                                        "author": "local-author", "parent_version_id": 1}])
            report["conclusion"]["claims"][1]["text"] += " This Transfer alone establishes no totalSupply change."
            report["quality_validation"] = report_quality(report, evidence)
            report["citation_validation"] = citation_validation(report, evidence)
        path = output_directory / f"uniswap93-synthetic-v{revision}.zip"
        manifest = export_bundle(evidence, report, fixture_markdown(report), path)
        verified = import_bundle(path)
        EvidenceSet.model_validate({**verified.evidence, "raw": verified.raw}, strict=True)
        if verified.manifest != manifest or citation_validation(verified.report, verified.evidence, verified.raw)["status"] != "valid":
            raise ValueError("The generated archive must retain its manifest and valid citations.")
        results.append({"path": path.name, "revision": revision, "manifest_hash": manifest_sha256(manifest),
                        "archive_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "verified": verified.verified})
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-directory", type=Path, default=FIXTURE_DIRECTORY)
    arguments = parser.parse_args()
    print(json.dumps(build_fixtures(arguments.output_directory), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
