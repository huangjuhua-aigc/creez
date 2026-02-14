import math


def image_price_calculator(**kwargs):
    model = kwargs.get("model")
    reference_image_list = kwargs.get("reference_image_list") or kwargs.get("reference_image")
    has_reference = False
    if reference_image_list:
        if isinstance(reference_image_list, str):
            has_reference = bool(reference_image_list.strip())
        elif isinstance(reference_image_list, list):
            has_reference = len(reference_image_list) > 0 and any(
                img.strip() if isinstance(img, str) else img for img in reference_image_list if img
            )

    model_lower = (model or "").lower()

    if model_lower == "doubao-seedream-4-0":
        return 2
    if model_lower == "doubao-seedream-4-5":
        return 2
    if model_lower == "gpt4o-image":
        usage = kwargs.get("usage", {})
        text_tokens = int(usage.get("textTokens", 0) or 0)
        image_tokens = int(usage.get("imageTokens", 0) or 0)
        output_tokens = int(usage.get("outputToken", 0) or 0)
        text_cost_rmb = text_tokens * 5 * 7.3 / 1_000_000
        image_cost_rmb = image_tokens * 10 * 7.3 / 1_000_000
        output_cost_rmb = output_tokens * 40 * 7.3 / 1_000_000
        total_rmb = text_cost_rmb + image_cost_rmb + output_cost_rmb
        return max(1, math.ceil(total_rmb / 0.1))
    if model_lower == "gemini-3-pro":
        return 5
    return 0


def video_price_calculator(**kwargs):
    model = kwargs.get("model")
    usage = kwargs.get("usage", {})
    tokens = int(usage.get("totalToken", 0) or 0)

    if model == "doubao-seedance-pro":
        generate_audio = kwargs.get("generate_audio", False) or usage.get("generateAudio", False)
        price_per_million = 16 if generate_audio else 8
        return max(1, math.ceil(tokens * price_per_million / 1_000_000 * 10))
    if model == "doubao-seedance-lite":
        return max(1, math.ceil(tokens * 10 / 1_000_000 * 10))
    return 0
