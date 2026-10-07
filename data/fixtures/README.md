# Synthetic evidence fixtures

`uniswap93-synthetic-v1.zip` and `uniswap93-synthetic-v2.zip` are deterministic demonstrations. The RPC observations come from `../cases/uniswap93/rpc.json`; attributed project summaries come from `../cases/uniswap93/sources.json`. The report explanation is an authored local fixture. Generation performs zero model requests, network reads, signatures and broadcasts.

Generate the archives from the project root:

```powershell
python scripts/build_public_fixtures.py
```

The generator uses the local `CachedRpc` adapter, collector and evidence tools. It validates `EvidenceSet`, structural citations and archive integrity before returning the archive digests. It fixes the collection timestamp to the source snapshot timestamp. Both archives use stored ZIP members, fixed member timestamps and canonical JSON, so repeated generation with the same inputs produces the same bytes.

The format is `cluetide-public-evidence/v1`, with five members: `raw.json`, `evidence.json`, `report.json`, `report.md` and `manifest.json`. JSON commitments use RFC 8785. Each manifest lists the SHA-256 and byte size of the four data files. The manifest has no self-hash; its canonical bytes supply the external manifest commitment.

`raw.synthetic_fixture` and `report.synthetic_fixture` identify `cluetide-synthetic-fixture/v1`, synthetic mode, the deterministic interpretation source, zero external-operation counts, and the relative source paths with their digests. Revision 2 links its parent manifest and clarifies the scope of the transfer claim. Local author and review roles are controlled demonstration roles.

Archive verification proves byte integrity. Citation validation checks structural bindings. Source authenticity, causal interpretation and independent review require separate review.

`python scripts/seed_demo.py` restores the v1 ZIP's original bytes into local SQL publication state while the local service is stopped. The v2 archive remains a reference for the correction flow.
