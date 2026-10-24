import json
import re
import sys
import tarfile


def inspect(stream):
    layers = 0
    violations = 0
    forbidden = re.compile(r"(?:^|/)(?:docker\.env(?:\..*)?|\.env(?:\..*)?|\.auth\.secret(?:\..*)?|dev\.db(?:-.*)?)$")
    with tarfile.open(fileobj=stream, mode="r|") as archive:
        for entry in archive:
            if not entry.isfile() or entry.name.endswith(".json") or entry.size < 512:
                continue
            source = archive.extractfile(entry)
            try:
                with tarfile.open(fileobj=source, mode="r|*") as layer:
                    layers += 1
                    for member in layer:
                        name = member.name.lstrip("./")
                        if not member.isfile() or not name.startswith("app/"):
                            continue
                        private_media = name.startswith(("app/public/uploads/", "app/public/canvases/")) and not name.endswith("/.gitkeep")
                        if forbidden.search(name) or private_media:
                            violations += 1
            except tarfile.ReadError:
                continue
    if not layers:
        raise ValueError("No readable image layers")
    return {"check": "image-layers", "layers": layers, "privateArtifacts": violations}


if __name__ == "__main__":
    try:
        result = inspect(sys.stdin.buffer)
        print(json.dumps(result))
        sys.exit(1 if result["privateArtifacts"] else 0)
    except (ValueError, tarfile.TarError, OSError):
        print("Image layer inspection failed", file=sys.stderr)
        sys.exit(1)
