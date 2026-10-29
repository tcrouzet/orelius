import json
import sys
import xml.etree.ElementTree as ET
import zipfile

NAMESPACES = {
    "container": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def read_xml(archive, name):
    with archive.open(name) as source:
        content = source.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        raise ValueError("Document de métadonnées trop volumineux")
    return ET.fromstring(content)


def metadata(path):
    with zipfile.ZipFile(path) as archive:
        container = read_xml(archive, "META-INF/container.xml")
        root = container.find("container:rootfiles/container:rootfile", NAMESPACES)
        if root is None or not root.get("full-path"):
            raise ValueError("Document OPF introuvable")
        package = read_xml(archive, root.get("full-path"))
        details = package.find("opf:metadata", NAMESPACES)
        if details is None:
            raise ValueError("Métadonnées OPF introuvables")

        def values(name):
            return [text for element in details.findall(f"dc:{name}", NAMESPACES)
                    if (text := " ".join("".join(element.itertext()).split()))]

        return {
            "title": next(iter(values("title")), "Sans titre"),
            "author": ", ".join(values("creator")) or "Auteur non renseigné",
        }


books = []
for path in json.load(sys.stdin):
    try:
        books.append(metadata(path))
    except (OSError, ValueError, KeyError, RuntimeError, zipfile.BadZipFile, ET.ParseError) as error:
        sys.exit(f"Métadonnées EPUB illisibles pour {path} : {error}")
json.dump(books, sys.stdout, ensure_ascii=False)
