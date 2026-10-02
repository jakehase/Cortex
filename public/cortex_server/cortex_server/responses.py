"""Response classes whose declared media types match their runtime bytes."""
from starlette.responses import FileResponse


class JavaScriptFileResponse(FileResponse):
    media_type = "application/javascript"


class SvgFileResponse(FileResponse):
    media_type = "image/svg+xml"


class WavFileResponse(FileResponse):
    media_type = "audio/wav"
