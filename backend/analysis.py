from __future__ import annotations

import csv
import math
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np


class AnalysisError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def risk_level(score: float) -> str:
    return "high" if score >= 0.70 else "medium" if score >= 0.45 else "low"


def _resize(image: np.ndarray, limit: int = 1600) -> np.ndarray:
    height, width = image.shape[:2]
    scale = min(1.0, limit / max(height, width))
    return cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else image


def _image_features(image: np.ndarray) -> tuple[dict[str, Any], np.ndarray]:
    if image is None or image.size == 0:
        raise AnalysisError("IMAGE_DECODE_FAILED", "Image could not be decoded.")
    image = _resize(image)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(gray)
    contrast = float(np.std(clahe) / 64)
    brightness = float(np.mean(gray) / 255)
    exposure = clamp(1 - abs(brightness - 0.5) * 2)
    blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharpness = clamp(math.log1p(blur_variance) / 7)
    median = float(np.median(clahe))
    lower = int(max(0, 0.66 * median))
    upper = int(min(255, max(lower + 20, 1.33 * median)))
    edges = cv2.Canny(clahe, lower, upper)
    sobel_x = cv2.Sobel(clahe, cv2.CV_32F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(clahe, cv2.CV_32F, 0, 1, ksize=3)
    gradient = cv2.magnitude(sobel_x, sobel_y)
    edge_density = float(np.count_nonzero(edges) / edges.size)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 3))
    linked = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(linked, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.shape[0] * image.shape[1]
    regions = []
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < image_area * 0.00015 or area > image_area * 0.12:
            continue
        x, y, width, height = cv2.boundingRect(contour)
        major = max(width, height)
        minor = max(1, min(width, height))
        linearity = clamp((major / minor - 1) / 14)
        local_gradient = float(np.mean(gradient[y:y + height, x:x + width]) / 255) if width and height else 0
        area_ratio = area / image_area
        region_score = clamp(0.45 * linearity + 0.35 * clamp(local_gradient) + 0.20 * clamp(area_ratio * 80))
        regions.append(
            {
                "bbox": [int(x), int(y), int(width), int(height)],
                "area": round(area, 1),
                "area_ratio": round(area_ratio, 6),
                "linearity": round(linearity, 4),
                "score": round(region_score, 4),
            }
        )
    regions.sort(key=lambda item: item["score"], reverse=True)
    regions = regions[:12]
    region_signal = float(np.mean([region["score"] for region in regions[:5]])) if regions else 0
    quality = clamp(0.35 * clamp(contrast) + 0.35 * sharpness + 0.30 * exposure)
    score = clamp(0.35 * clamp(edge_density * 8) + 0.35 * region_signal + 0.30 * clamp(float(np.mean(gradient)) / 80))
    features = {
        "quality": round(quality, 4),
        "contrast": round(contrast, 4),
        "brightness": round(brightness, 4),
        "sharpness": round(sharpness, 4),
        "edge_density": round(edge_density, 5),
        "region_count": len(regions),
        "regions": regions,
        "score": round(score, 4),
        "level": risk_level(score),
        "explanation_codes": [code for condition, code in ((edge_density > 0.12, "DENSE_EDGES"), (region_signal > 0.55, "LINEAR_REGIONS"), (quality < 0.4, "LOW_IMAGE_QUALITY")) if condition] or ["NO_STRONG_SURFACE_SIGNAL"],
    }
    return features, image


def _annotate(image: np.ndarray, regions: list[dict[str, Any]], label: str) -> np.ndarray:
    output = image.copy()
    for region in regions[:8]:
        x, y, width, height = region["bbox"]
        color = (76, 180, 231) if region["score"] < 0.7 else (88, 105, 232)
        cv2.rectangle(output, (x, y), (x + width, y + height), color, 2)
    cv2.rectangle(output, (0, 0), (output.shape[1], 42), (8, 22, 23), -1)
    cv2.putText(output, label, (14, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (232, 240, 236), 1, cv2.LINE_AA)
    return output


def analyze_rgb(path: Path, artifact_dir: Path, analysis_id: str) -> dict[str, Any]:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    features, resized = _image_features(image)
    artifact = f"{analysis_id}-rgb.jpg"
    if not cv2.imwrite(str(artifact_dir / artifact), _annotate(resized, features["regions"], "Surface anomaly candidates")):
        raise AnalysisError("ARTIFACT_WRITE_FAILED", "Annotated image could not be saved.")
    return {**features, "artifact": artifact}


def _numeric_matrix(path: Path) -> np.ndarray:
    rows: list[list[float]] = []
    try:
        with path.open(newline="", encoding="utf-8-sig") as file:
            for raw in csv.reader(file):
                if not raw or all(not cell.strip() for cell in raw):
                    continue
                rows.append([float(cell.strip()) for cell in raw])
    except (UnicodeDecodeError, ValueError) as error:
        raise AnalysisError("CSV_INVALID_NUMBER", "CSV contains non-numeric or invalid values.") from error
    if len(rows) < 3 or len({len(row) for row in rows}) != 1 or len(rows[0]) < 3:
        raise AnalysisError("THERMAL_MATRIX_INVALID", "Thermal CSV must be a rectangular numeric matrix of at least 3 x 3.")
    matrix = np.asarray(rows, dtype=np.float64)
    if not np.isfinite(matrix).all():
        raise AnalysisError("CSV_NON_FINITE", "CSV contains NaN or infinite values.")
    return matrix


def analyze_thermal(path: Path) -> dict[str, Any]:
    matrix = _numeric_matrix(path)
    median = float(np.median(matrix))
    mad = float(np.median(np.abs(matrix - median)))
    scale = max(1e-6, 1.4826 * mad)
    robust_z = np.abs(matrix - median) / scale
    mask = (robust_z >= 3.0).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    regions = []
    for label in range(1, count):
        x, y, width, height, area = stats[label].tolist()
        if area < 2:
            continue
        local = robust_z[y:y + height, x:x + width]
        regions.append({"bbox": [x, y, width, height], "area": area, "peak_z": round(float(np.max(local)), 3)})
    regions.sort(key=lambda item: item["peak_z"], reverse=True)
    max_delta = float(np.max(np.abs(matrix - median)))
    anomalous_area = float(np.count_nonzero(mask) / mask.size)
    peak = float(np.max(robust_z))
    score = clamp(0.45 * clamp(peak / 8) + 0.30 * clamp(max_delta / 12) + 0.25 * clamp(anomalous_area * 18))
    spread = float(np.ptp(matrix))
    quality = clamp(0.55 + 0.30 * clamp(spread / 8) + 0.15 * clamp(matrix.size / 256))
    return {
        "quality": round(quality, 4), "median": round(median, 4), "mad": round(mad, 4), "max_delta": round(max_delta, 4),
        "anomalous_area_ratio": round(anomalous_area, 5), "regions": regions[:12], "score": round(score, 4), "level": risk_level(score),
        "explanation_codes": [code for condition, code in ((peak >= 5, "ROBUST_OUTLIER"), (max_delta >= 6, "THERMAL_DELTA"), (anomalous_area >= 0.04, "CONTIGUOUS_THERMAL_REGION")) if condition] or ["NO_STRONG_THERMAL_SIGNAL"],
    }


def _parse_timestamp(value: str) -> float:
    try:
        return float(value)
    except ValueError:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError as error:
            raise AnalysisError("TIMESTAMP_INVALID", "Sensor timestamp must be numeric or ISO-8601.") from error


def analyze_sensor(path: Path) -> dict[str, Any]:
    samples: dict[float, float] = {}
    try:
        with path.open(newline="", encoding="utf-8-sig") as file:
            reader = csv.DictReader(file)
            if not reader.fieldnames or not {"timestamp", "value"}.issubset(set(reader.fieldnames)):
                raise AnalysisError("SENSOR_COLUMNS_INVALID", "Sensor CSV requires timestamp and value columns.")
            for row in reader:
                timestamp = _parse_timestamp((row.get("timestamp") or "").strip())
                value = float((row.get("value") or "").strip())
                if not math.isfinite(timestamp) or not math.isfinite(value):
                    raise AnalysisError("CSV_NON_FINITE", "CSV contains NaN or infinite values.")
                samples[timestamp] = value
    except UnicodeDecodeError as error:
        raise AnalysisError("CSV_ENCODING_INVALID", "Sensor CSV must use UTF-8 encoding.") from error
    except ValueError as error:
        if isinstance(error, AnalysisError):
            raise
        raise AnalysisError("CSV_INVALID_NUMBER", "Sensor CSV contains invalid values.") from error
    if len(samples) < 8:
        raise AnalysisError("SENSOR_SAMPLE_SHORT", "Sensor CSV requires at least eight unique samples.")
    ordered = sorted(samples.items())
    timestamps = np.asarray([item[0] for item in ordered], dtype=np.float64)
    values = np.asarray([item[1] for item in ordered], dtype=np.float64)
    if timestamps[-1] <= timestamps[0]:
        raise AnalysisError("SENSOR_TIME_RANGE_INVALID", "Sensor timestamps must span a positive interval.")
    target_time = np.linspace(timestamps[0], timestamps[-1], len(values))
    resampled = np.interp(target_time, timestamps, values)
    slope, intercept = np.polyfit(target_time - target_time[0], resampled, 1)
    detrended = resampled - (slope * (target_time - target_time[0]) + intercept)
    standard_deviation = float(np.std(detrended))
    normalized = detrended / max(standard_deviation, 1e-9)
    spectrum = np.abs(np.fft.rfft(normalized)) ** 2
    useful = spectrum[1:]
    split = max(1, len(useful) // 2)
    high_ratio = float(np.sum(useful[split:]) / max(np.sum(useful), 1e-9))
    sample_interval = float((target_time[-1] - target_time[0]) / max(1, len(target_time) - 1))
    frequencies = np.fft.rfftfreq(len(normalized), d=max(sample_interval, 1e-9))
    dominant_index = int(np.argmax(spectrum[1:]) + 1) if len(spectrum) > 1 else 0
    change_points = []
    positive = negative = 0.0
    threshold = 3.5
    for index, value in enumerate(normalized):
        positive = max(0.0, positive + float(value) - 0.35)
        negative = min(0.0, negative + float(value) + 0.35)
        if positive > threshold or negative < -threshold:
            change_points.append({"index": index, "timestamp": round(float(target_time[index]), 4), "strength": round(max(positive, -negative), 3)})
            positive = negative = 0.0
    rms = float(np.sqrt(np.mean(detrended**2)))
    scale = max(float(np.std(resampled)), abs(float(np.mean(resampled))) * 0.05, 1e-6)
    rms_norm = clamp(rms / (scale * 1.5))
    trend_norm = clamp(abs(float(slope)) * (timestamps[-1] - timestamps[0]) / max(float(np.ptp(resampled)), 1e-6))
    change_norm = clamp(len(change_points) / 5)
    score = clamp(0.30 * rms_norm + 0.25 * high_ratio + 0.25 * change_norm + 0.20 * trend_norm)
    irregularity = float(np.std(np.diff(timestamps)) / max(np.mean(np.diff(timestamps)), 1e-9))
    quality = clamp(0.72 + 0.18 * clamp(len(samples) / 64) - 0.25 * clamp(irregularity))
    return {
        "quality": round(quality, 4), "sample_count": len(samples), "rms": round(rms, 6), "trend_slope": round(float(slope), 8),
        "dominant_frequency_hz": round(float(frequencies[dominant_index]), 6), "high_band_ratio": round(high_ratio, 4),
        "change_points": change_points[:20], "series": [{"timestamp": round(float(t), 4), "value": round(float(v), 6)} for t, v in zip(target_time, resampled)],
        "score": round(score, 4), "level": risk_level(score),
        "explanation_codes": [code for condition, code in ((high_ratio > 0.45, "HIGH_FREQUENCY_ENERGY"), (len(change_points) > 0, "CUSUM_CHANGE"), (trend_norm > 0.55, "SIGNIFICANT_TREND")) if condition] or ["NO_STRONG_SIGNAL_ANOMALY"],
    }


def analyze_video(path: Path, artifact_dir: Path, analysis_id: str) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise AnalysisError("VIDEO_DECODE_FAILED", "Video could not be decoded.")
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if fps <= 0 or frame_count <= 0:
        capture.release()
        raise AnalysisError("VIDEO_METADATA_INVALID", "Video frame rate or duration is invalid.")
    duration = frame_count / fps
    if duration > 60.1:
        capture.release()
        raise AnalysisError("VIDEO_DURATION_LIMIT", "Video must not exceed 60 seconds.")
    sample_interval = max(1, round(fps / 2))
    curve: list[dict[str, Any]] = []
    candidates: list[tuple[float, float, bytes, list[dict[str, Any]]]] = []
    index = 0
    while len(curve) < 120:
        ok, frame = capture.read()
        if not ok:
            break
        if index % sample_interval == 0:
            features, resized = _image_features(frame)
            timestamp = index / fps
            curve.append({"time_s": round(timestamp, 3), "score": features["score"], "level": features["level"]})
            encoded_ok, encoded = cv2.imencode(".jpg", resized, [cv2.IMWRITE_JPEG_QUALITY, 84])
            if encoded_ok:
                candidates.append((features["score"], timestamp, encoded.tobytes(), features["regions"]))
                candidates = sorted(candidates, key=lambda item: item[0], reverse=True)[:16]
        index += 1
    capture.release()
    if not curve:
        raise AnalysisError("VIDEO_NO_FRAMES", "Video contained no readable frames.")
    selected: list[tuple[float, float, bytes, list[dict[str, Any]]]] = []
    for candidate in sorted(candidates, key=lambda item: item[0], reverse=True):
        if all(abs(candidate[1] - item[1]) >= 1.0 for item in selected):
            selected.append(candidate)
        if len(selected) == 5:
            break
    keyframes = []
    artifacts = []
    for rank, (score, timestamp, data, regions) in enumerate(selected, 1):
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        artifact = f"{analysis_id}-frame-{rank}.jpg"
        label = f"t={timestamp:.1f}s  risk={score:.2f}"
        cv2.imwrite(str(artifact_dir / artifact), _annotate(image, regions, label))
        keyframes.append({"time_s": round(timestamp, 3), "score": round(score, 4), "artifact": artifact})
        artifacts.append(artifact)
    scores = np.asarray([point["score"] for point in curve], dtype=np.float64)
    score = clamp(float(np.mean(np.sort(scores)[-max(1, len(scores) // 5):])))
    quality = clamp(0.65 + min(len(curve), 60) / 200)
    return {
        "quality": round(quality, 4), "duration_s": round(duration, 3), "source_fps": round(fps, 3), "sampling_fps": 2,
        "sampled_frames": len(curve), "curve": curve, "keyframes": keyframes, "artifacts": artifacts,
        "score": round(score, 4), "level": risk_level(score),
        "explanation_codes": ["TEMPORAL_SURFACE_PEAK"] if max(scores) >= 0.70 else ["NO_STRONG_VIDEO_SIGNAL"],
    }


def fuse(modalities: dict[str, dict[str, Any]]) -> dict[str, Any]:
    base = {"rgb": 0.45, "video": 0.45, "thermal": 0.30, "sensor": 0.25}
    raw = {name: base[name] * float(value["quality"]) for name, value in modalities.items()}
    denominator = sum(raw.values()) or 1.0
    weights = {name: weight / denominator for name, weight in raw.items()}
    contributions = {name: weights[name] * float(modalities[name]["score"]) for name in modalities}
    score = clamp(sum(contributions.values()))
    codes = []
    for name, value in modalities.items():
        if value["score"] >= 0.70:
            codes.append(f"{name.upper()}_HIGH")
        if value["quality"] < 0.45:
            codes.append(f"{name.upper()}_QUALITY_LOW")
    return {
        "score": round(score, 4), "level": risk_level(score),
        "effective_weights": {name: round(value, 4) for name, value in weights.items()},
        "contributions": {name: round(value, 4) for name, value in contributions.items()},
        "explanation_codes": codes or ["NO_MODALITY_ABOVE_HIGH_THRESHOLD"],
    }


def analyze_bundle(
    paths: dict[str, Path],
    artifact_dir: Path,
    analysis_id: str,
    progress: Callable[[int], None] | None = None,
) -> dict[str, Any]:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    modalities: dict[str, dict[str, Any]] = {}
    tasks = list(paths)
    for index, name in enumerate(tasks):
        if name == "rgb":
            modalities[name] = analyze_rgb(paths[name], artifact_dir, analysis_id)
        elif name == "video":
            modalities[name] = analyze_video(paths[name], artifact_dir, analysis_id)
        elif name == "thermal":
            modalities[name] = analyze_thermal(paths[name])
        elif name == "sensor":
            modalities[name] = analyze_sensor(paths[name])
        if progress:
            progress(round((index + 1) / max(1, len(tasks)) * 90))
    artifacts = []
    for value in modalities.values():
        if value.get("artifact"):
            artifacts.append(value["artifact"])
        artifacts.extend(value.get("artifacts", []))
    result = {"modalities": modalities, "fusion": fuse(modalities), "artifacts": artifacts}
    if progress:
        progress(100)
    return result
