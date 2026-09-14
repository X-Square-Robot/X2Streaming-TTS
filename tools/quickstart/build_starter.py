"""Build the self-contained starter download without including weights or state."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "web/packages/demo/public/x2streaming-quickstart.zip"
FILES = [
    "quickstart.sh",
    "LICENSE",
    "docs/quickstart.md",
    "tools/quickstart/launch.py",
    "tools/quickstart/gateway.py",
    "tools/quickstart/service.py",
    "tools/quickstart/manifest.json",
    "tools/quickstart/requirements.txt",
]

if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED) as archive:
        for name in FILES:
            info = ZipInfo(
                "x2streaming-quickstart/" + name, date_time=(2026, 9, 14, 0, 0, 0)
            )
            info.compress_type = ZIP_DEFLATED
            info.external_attr = (
                0o100755 if name == "quickstart.sh" else 0o100644
            ) << 16
            archive.writestr(info, (ROOT / name).read_bytes())
    print("Built starter download:", OUTPUT)
