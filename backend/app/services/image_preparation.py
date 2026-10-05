"""
ImagePreparationService:
- fetches image bytes from Immich
- validates content type and file size
- resizes if needed
- converts to base64 data URL
- returns provider-safe image payload

Never exposes private Immich URLs to external AI providers.
"""
import base64
import io
from typing import Any, Dict, List, Optional, Tuple
from ..config import settings
from .immich_client import ImmichClient, ImmichError

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/gif",
    "image/webp", "image/bmp", "image/tiff",
}
ANNOTATED_MAX_DIMENSION = 1920


class ImagePreparationError(Exception):
    pass


class ImagePreparationService:
    def __init__(self, immich_client: Optional[ImmichClient] = None):
        self.immich_client = immich_client or ImmichClient()
        self.max_bytes = settings.MAX_IMAGE_BYTES
        self.target_size: Tuple[int, int] = settings.thumbnail_size

    def prepare_for_provider(
        self,
        asset_id: str,
        size: str = "thumbnail",
        face_annotations: Optional[List[Dict[str, Any]]] = None,
    ) -> dict:
        """
        Fetch and prepare image for AI provider.
        Returns: {"data_url": str, "mime_type": str, "size_bytes": int}
        """
        annotations = face_annotations or []
        if annotations:
            size = "preview"
        try:
            image_bytes = self.immich_client.get_thumbnail(asset_id, size=size)
        except ImmichError as e:
            raise ImagePreparationError(f"Could not fetch thumbnail: {e}")

        if len(image_bytes) > self.max_bytes:
            raise ImagePreparationError(
                f"Image too large: {len(image_bytes)} bytes (max {self.max_bytes})"
            )

        mime_type, processed_bytes = self._process_image(
            image_bytes,
            face_annotations=annotations,
        )

        data_url = self._to_data_url(processed_bytes, mime_type)

        payload = {
            "data_url": data_url,
            "mime_type": mime_type,
            "size_bytes": len(processed_bytes),
        }
        if annotations:
            payload["detail"] = "high"
            payload["annotated_faces"] = len(annotations)
        return payload

    def _process_image(
        self,
        image_bytes: bytes,
        face_annotations: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, bytes]:
        """Detect mime type and resize if needed. Returns (mime_type, bytes)."""
        if not PIL_AVAILABLE:
            if face_annotations:
                raise ImagePreparationError(
                    "Pillow is required to annotate recognized faces"
                )
            return "image/jpeg", image_bytes

        try:
            annotations = face_annotations or []
            img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes)))
            fmt = (img.format or "JPEG").upper()
            mime_type = f"image/{fmt.lower()}"
            if mime_type not in ALLOWED_MIME_TYPES:
                mime_type = "image/jpeg"
                fmt = "JPEG"

            # Convert palette/RGBA to RGB for JPEG compatibility
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")
                mime_type = "image/jpeg"
                fmt = "JPEG"

            if annotations:
                img.thumbnail(
                    (ANNOTATED_MAX_DIMENSION, ANNOTATED_MAX_DIMENSION),
                    Image.LANCZOS,
                )
                img = img.convert("RGB")
                self._draw_face_annotations(img, annotations)
                mime_type = "image/jpeg"
                fmt = "JPEG"
            elif img.width > self.target_size[0] or img.height > self.target_size[1]:
                img.thumbnail(self.target_size, Image.LANCZOS)

            buf = io.BytesIO()
            save_fmt = "JPEG" if fmt not in {"PNG", "GIF", "WEBP"} else fmt
            # Keep MIME type in sync with the actual saved format
            mime_type = f"image/{save_fmt.lower()}"
            img.save(buf, format=save_fmt, quality=85)
            return mime_type, buf.getvalue()

        except Exception as e:
            raise ImagePreparationError(f"Image processing failed: {e}")

    def _draw_face_annotations(
        self,
        image: Any,
        annotations: List[Dict[str, Any]],
    ) -> None:
        draw = ImageDraw.Draw(image)
        colors = ("#00FFFF", "#FFD700", "#FF4FD8", "#7CFC00", "#FF8C00")
        marker_size = max(64, image.width // 21)
        font_size = max(40, int(marker_size * 0.7))
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
        except OSError:
            try:
                font = ImageFont.load_default(size=font_size)
            except TypeError:
                font = ImageFont.load_default()

        for annotation in annotations:
            source_width = annotation["image_width"]
            source_height = annotation["image_height"]
            scale_x = image.width / source_width
            scale_y = image.height / source_height
            box = (
                round(annotation["bounding_box_x1"] * scale_x),
                round(annotation["bounding_box_y1"] * scale_y),
                round(annotation["bounding_box_x2"] * scale_x),
                round(annotation["bounding_box_y2"] * scale_y),
            )
            color = colors[(annotation["label"] - 1) % len(colors)]
            line_width = max(5, image.width // 190)
            draw.rectangle(box, outline=color, width=line_width)

            marker_x = max(0, box[0])
            marker_y = max(0, box[1] - marker_size)
            marker_box = (
                marker_x,
                marker_y,
                marker_x + marker_size,
                marker_y + marker_size,
            )
            draw.ellipse(marker_box, fill=color, outline="black", width=3)
            label = str(annotation["label"])
            text_box = draw.textbbox((0, 0), label, font=font)
            text_width = text_box[2] - text_box[0]
            text_height = text_box[3] - text_box[1]
            draw.text(
                (
                    marker_x + (marker_size - text_width) / 2,
                    marker_y + (marker_size - text_height) / 2 - 5,
                ),
                label,
                fill="black",
                font=font,
            )

    def _to_data_url(self, image_bytes: bytes, mime_type: str) -> str:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        return f"data:{mime_type};base64,{b64}"
