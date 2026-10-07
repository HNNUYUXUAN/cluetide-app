"""Synthetic fixtures have reproducible bytes and explicit evidence provenance."""
import importlib.util
from pathlib import Path
import zipfile

from cluetide.bundles import import_bundle, manifest_sha256
from cluetide.citation_validation import citation_validation


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("public_fixture_generator", ROOT / "scripts/build_public_fixtures.py")
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


def test_regeneration_matches_frozen_bytes_and_stored_zip_profile(tmp_path):
    summaries = generator.build_fixtures(tmp_path)
    for summary in summaries:
        path = tmp_path / summary["path"]
        assert path.read_bytes() == (ROOT / "data/fixtures" / summary["path"]).read_bytes()
        with zipfile.ZipFile(path) as archive:
            assert all(item.compress_type == zipfile.ZIP_STORED for item in archive.infolist())
            assert all(item.date_time == (1980, 1, 1, 0, 0, 0) for item in archive.infolist())
        assert summary["verified"] is True


def test_synthetic_protocol_and_directed_evidence_are_explicit():
    parent = None
    for revision in (1, 2):
        source = import_bundle(ROOT / "data/fixtures" / f"uniswap93-synthetic-v{revision}.zip")
        report, raw = source.report, source.raw
        fixture = report["synthetic_fixture"]
        assert fixture == raw["synthetic_fixture"]
        assert fixture["mode"] == "synthetic"
        assert fixture["interpretation_source"] == "deterministic_local_fixture"
        assert fixture["model_requests"] == fixture["network_reads"] == fixture["transactions_signed_or_broadcast"] == 0
        assert report["agent"]["model_requests"] == 0 and report["agent"]["model_names"] == []
        assert {item["status"] for item in report["conclusion"]["assessments"]} == {"supported", "refuted", "unknown"}
        assert report["parent_manifest_hash"] == parent
        assert citation_validation(report, source.evidence, raw)["status"] == "valid"
        parent = manifest_sha256(source.manifest)
