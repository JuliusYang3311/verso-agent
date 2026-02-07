#!/usr/bin/env python3
"""
Voice/TTS service for video generation.
Uses edge-tts for free text-to-speech (Microsoft Edge TTS).
Adapted from MoneyPrinterTurbo.
"""

import asyncio
import os
import re
from typing import Union
from xml.sax.saxutils import unescape

import edge_tts
from edge_tts import SubMaker, submaker
from edge_tts.submaker import mktimestamp
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip

from . import utils


def get_all_azure_voices(filter_locals=None):
    """Get list of available edge-tts voices."""
    # Common voices for different languages
    voices = [
        # English (US)
        "en-US-JennyNeural-Female",
        "en-US-GuyNeural-Male", 
        "en-US-AriaNeural-Female",
        "en-US-DavisNeural-Male",
        "en-US-AmberNeural-Female",
        "en-US-AnaNeural-Female",
        "en-US-ChristopherNeural-Male",
        "en-US-EricNeural-Male",
        # English (UK)
        "en-GB-SoniaNeural-Female",
        "en-GB-RyanNeural-Male",
        # Chinese (Simplified)
        "zh-CN-XiaoxiaoNeural-Female",
        "zh-CN-YunxiNeural-Male",
        "zh-CN-XiaoyiNeural-Female",
        "zh-CN-YunjianNeural-Male",
        "zh-CN-XiaochenNeural-Female",
        "zh-CN-XiaohanNeural-Female",
        "zh-CN-XiaomengNeural-Female",
        "zh-CN-XiaomoNeural-Female",
        "zh-CN-XiaoqiuNeural-Female",
        "zh-CN-XiaoruiNeural-Female",
        "zh-CN-XiaoshuangNeural-Female",
        "zh-CN-XiaoxuanNeural-Female",
        "zh-CN-XiaoyanNeural-Female",
        "zh-CN-XiaoyouNeural-Female",
        "zh-CN-XiaozhenNeural-Female",
        "zh-CN-YunfengNeural-Male",
        "zh-CN-YunhaoNeural-Male",
        "zh-CN-YunyangNeural-Male",
        "zh-CN-YunyeNeural-Male",
        "zh-CN-YunzeNeural-Male",
        # Chinese (Traditional - Taiwan)
        "zh-TW-HsiaoChenNeural-Female",
        "zh-TW-YunJheNeural-Male",
        "zh-TW-HsiaoYuNeural-Female",
        # Chinese (Traditional - Hong Kong)
        "zh-HK-HiuMaanNeural-Female",
        "zh-HK-WanLungNeural-Male",
        # Japanese
        "ja-JP-NanamiNeural-Female",
        "ja-JP-KeitaNeural-Male",
        # Korean
        "ko-KR-SunHiNeural-Female",
        "ko-KR-InJoonNeural-Male",
        # Spanish
        "es-ES-ElviraNeural-Female",
        "es-ES-AlvaroNeural-Male",
        "es-MX-DaliaNeural-Female",
        "es-MX-JorgeNeural-Male",
        # French
        "fr-FR-DeniseNeural-Female",
        "fr-FR-HenriNeural-Male",
        # German
        "de-DE-KatjaNeural-Female",
        "de-DE-ConradNeural-Male",
        # Portuguese
        "pt-BR-FranciscaNeural-Female",
        "pt-BR-AntonioNeural-Male",
        # Russian
        "ru-RU-SvetlanaNeural-Female",
        "ru-RU-DmitryNeural-Male",
        # Arabic
        "ar-SA-ZariyahNeural-Female",
        "ar-SA-HamedNeural-Male",
        # Hindi
        "hi-IN-SwaraNeural-Female",
        "hi-IN-MadhurNeural-Male",
    ]
    
    if filter_locals:
        return [v for v in voices if any(loc in v for loc in filter_locals)]
    return voices


def parse_voice_name(name: str) -> str:
    """Parse voice name, removing gender suffix."""
    if "-Male" in name or "-Female" in name:
        name = re.sub(r"-(Male|Female)$", "", name)
    return name


def convert_rate_to_percent(rate: float) -> str:
    """Convert rate float to percent string for edge-tts."""
    if rate == 1.0:
        return "+0%"
    percent = round((rate - 1.0) * 100)
    if percent > 0:
        return f"+{percent}%"
    return f"{percent}%"


def tts(
    text: str,
    voice_name: str,
    voice_rate: float,
    voice_file: str,
    voice_volume: float = 1.0,
) -> Union[SubMaker, None]:
    """
    Generate text-to-speech audio using edge-tts (free).
    
    Args:
        text: Text to convert to speech
        voice_name: Voice name (e.g., "en-US-JennyNeural", "zh-CN-XiaoxiaoNeural")
        voice_rate: Speech rate (1.0 = normal, >1.0 = faster, <1.0 = slower)
        voice_file: Output audio file path (.mp3)
        voice_volume: Volume level (currently unused by edge-tts)
    
    Returns:
        SubMaker object with timing info for subtitles, or None on failure
    """
    voice_name = parse_voice_name(voice_name)
    text = text.strip()
    rate_str = convert_rate_to_percent(voice_rate)
    
    for i in range(3):
        try:
            logger.info(f"start TTS, voice: {voice_name}, attempt: {i + 1}")

            async def _do() -> SubMaker:
                communicate = edge_tts.Communicate(text, voice_name, rate=rate_str)
                sub_maker = edge_tts.SubMaker()
                with open(voice_file, "wb") as file:
                    async for chunk in communicate.stream():
                        if chunk["type"] == "audio":
                            file.write(chunk["data"])
                        elif chunk["type"] == "WordBoundary":
                            sub_maker.create_sub(
                                (chunk["offset"], chunk["duration"]), chunk["text"]
                            )
                return sub_maker

            sub_maker = asyncio.run(_do())
            if not sub_maker or not sub_maker.subs:
                logger.warning("TTS returned empty subtitles, retrying...")
                continue

            logger.info(f"TTS completed: {voice_file}")
            return sub_maker
        except Exception as e:
            logger.error(f"TTS error: {str(e)}")
    
    return None


def _format_text(text: str) -> str:
    """Clean text for subtitle processing."""
    text = text.replace("[", " ")
    text = text.replace("]", " ")
    text = text.replace("(", " ")
    text = text.replace(")", " ")
    text = text.replace("{", " ")
    text = text.replace("}", " ")
    return text.strip()


def create_subtitle(sub_maker: submaker.SubMaker, text: str, subtitle_file: str):
    """
    Create optimized SRT subtitle file from TTS timing data.
    
    1. Split text by punctuation into sentences
    2. Match each sentence with TTS word boundaries
    3. Generate SRT file with sentence-level subtitles
    """
    text = _format_text(text)

    def formatter(idx: int, start_time: float, end_time: float, sub_text: str) -> str:
        start_t = mktimestamp(start_time).replace(".", ",")
        end_t = mktimestamp(end_time).replace(".", ",")
        return f"{idx}\n{start_t} --> {end_t}\n{sub_text}\n"

    start_time = -1.0
    sub_items = []
    sub_index = 0

    script_lines = utils.split_string_by_punctuations(text)

    def match_line(_sub_line: str, _sub_index: int):
        if len(script_lines) <= _sub_index:
            return ""

        _line = script_lines[_sub_index]
        if _sub_line == _line:
            return script_lines[_sub_index].strip()

        _sub_line_ = re.sub(r"[^\w\s]", "", _sub_line)
        _line_ = re.sub(r"[^\w\s]", "", _line)
        if _sub_line_ == _line_:
            return _line_.strip()

        _sub_line_ = re.sub(r"\W+", "", _sub_line)
        _line_ = re.sub(r"\W+", "", _line)
        if _sub_line_ == _line_:
            return _line.strip()

        return ""

    sub_line = ""

    try:
        for _, (offset, sub) in enumerate(zip(sub_maker.offset, sub_maker.subs)):
            _start_time, end_time = offset
            if start_time < 0:
                start_time = _start_time

            sub = unescape(sub)
            sub_line += sub
            sub_text = match_line(sub_line, sub_index)
            if sub_text:
                sub_index += 1
                line = formatter(
                    idx=sub_index,
                    start_time=start_time,
                    end_time=end_time,
                    sub_text=sub_text,
                )
                sub_items.append(line)
                start_time = -1.0
                sub_line = ""

        if sub_items:
            with open(subtitle_file, "w", encoding="utf-8") as file:
                file.write("\n".join(sub_items) + "\n")
            logger.info(f"subtitle created: {subtitle_file}")
        else:
            logger.warning(f"no subtitle items generated")

    except Exception as e:
        logger.error(f"subtitle creation failed: {str(e)}")


def _get_audio_duration_from_submaker(sub_maker: submaker.SubMaker) -> float:
    """Get audio duration from SubMaker timing data."""
    if not sub_maker.offset:
        return 0.0
    return sub_maker.offset[-1][1] / 10000000


def _get_audio_duration_from_mp3(mp3_file: str) -> float:
    """Get audio duration from MP3 file."""
    if not os.path.exists(mp3_file):
        logger.error(f"MP3 file not found: {mp3_file}")
        return 0.0

    try:
        with AudioFileClip(mp3_file) as audio:
            return audio.duration
    except Exception as e:
        logger.error(f"Failed to get audio duration: {str(e)}")
        return 0.0


def get_audio_duration(target: Union[str, submaker.SubMaker]) -> float:
    """
    Get audio duration in seconds.
    
    Args:
        target: Either a SubMaker object or path to MP3 file
    
    Returns:
        Duration in seconds
    """
    if isinstance(target, submaker.SubMaker):
        return _get_audio_duration_from_submaker(target)
    elif isinstance(target, str) and target.endswith(".mp3"):
        return _get_audio_duration_from_mp3(target)
    else:
        logger.error(f"Invalid target type: {type(target)}")
        return 0.0


if __name__ == "__main__":
    # Test TTS
    test_text = "Hello, this is a test of edge-tts text-to-speech."
    test_file = "/tmp/test_tts.mp3"
    
    result = tts(test_text, "en-US-JennyNeural", 1.0, test_file)
    if result:
        print(f"Duration: {get_audio_duration(result)}s")
        create_subtitle(result, test_text, "/tmp/test_tts.srt")
