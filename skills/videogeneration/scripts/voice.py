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
# from edge_tts.submaker import mktimestamp
from loguru import logger
from moviepy.audio.io.AudioFileClip import AudioFileClip

from . import utils

def mktimestamp(microseconds: int) -> str:
    """Replicate edge-tts mktimestamp for older compatibility."""
    from datetime import timedelta
    td = timedelta(microseconds=microseconds / 10)
    hrs, secs_remainder = divmod(td.seconds, 3600)
    hrs += td.days * 24
    mins, secs = divmod(secs_remainder, 60)
    msecs = td.microseconds // 1000
    return f"{int(hrs):02}:{int(mins):02}:{int(secs):02}.{int(msecs):03}"


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
                        elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                            sub_maker.feed(chunk)
                return sub_maker

            sub_maker = asyncio.run(_do())
            if not sub_maker or not sub_maker.cues:
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


def _fuzzy_match_text(text1: str, text2: str) -> float:
    """
    Calculate similarity between two text strings.
    Returns a score between 0.0 and 1.0.
    Handles Chinese and English text.
    """
    # Remove all punctuation and whitespace for comparison
    import string
    
    def clean_text(t: str) -> str:
        # Remove punctuation
        for p in string.punctuation + '，。！？；：、':
            t = t.replace(p, '')
        # Remove whitespace
        t = ''.join(t.split())
        return t.lower()
    
    clean1 = clean_text(text1)
    clean2 = clean_text(text2)
    
    if not clean1 or not clean2:
        return 0.0
    
    # Exact match
    if clean1 == clean2:
        return 1.0
    
    # Check if one contains the other
    if clean1 in clean2 or clean2 in clean1:
        shorter = min(len(clean1), len(clean2))
        longer = max(len(clean1), len(clean2))
        return shorter / longer
    
    # Calculate character overlap
    set1 = set(clean1)
    set2 = set(clean2)
    intersection = len(set1 & set2)
    union = len(set1 | set2)
    
    if union == 0:
        return 0.0
    
    return intersection / union


def _create_fallback_subtitles(sub_maker: submaker.SubMaker, max_duration_per_line: float = 3.0) -> list:
    """
    Create simple time-based subtitles from word boundaries.
    Groups words into readable chunks based on time windows.
    
    Args:
        sub_maker: SubMaker object with word timing data
        max_duration_per_line: Maximum duration for each subtitle line in seconds
    
    Returns:
        List of formatted SRT subtitle strings
    """
    if not sub_maker.cues:
        return []
    
    def formatter(idx: int, start_time: float, end_time: float, sub_text: str) -> str:
        start_t = mktimestamp(start_time).replace(".", ",")
        end_t = mktimestamp(end_time).replace(".", ",")
        return f"{idx}\n{start_t} --> {end_t}\n{sub_text}\n"
    
    sub_items = []
    current_text = ""
    start_time = None
    sub_index = 1
    
    for cue in sub_maker.cues:
        start_time_micro = cue.start.total_seconds() * 10000000
        end_time_micro = cue.end.total_seconds() * 10000000
        
        if start_time is None:
            start_time = start_time_micro
        
        word = unescape(cue.content)
        current_text += word
        
        # Calculate current duration
        current_duration = (end_time_micro - start_time) / 10000000
        
        # Create subtitle if duration exceeds threshold or this is the last cue
        if current_duration >= max_duration_per_line or cue == sub_maker.cues[-1]:
            if current_text.strip():
                line = formatter(
                    idx=sub_index,
                    start_time=start_time,
                    end_time=end_time_micro,
                    sub_text=current_text.strip()
                )
                sub_items.append(line)
                sub_index += 1
                current_text = ""
                start_time = None
    
    return sub_items


def create_subtitle(sub_maker: submaker.SubMaker, text: str, subtitle_file: str):
    """
    Create optimized SRT subtitle file from TTS timing data.
    
    Uses a hybrid approach:
    1. Try to match TTS word boundaries with script sentences (primary)
    2. If that fails, use simple time-based grouping (fallback)
    
    This ensures subtitles are always generated.
    """
    text = _format_text(text)

    def formatter(idx: int, start_time: float, end_time: float, sub_text: str) -> str:
        start_t = mktimestamp(start_time).replace(".", ",")
        end_t = mktimestamp(end_time).replace(".", ",")
        return f"{idx}\n{start_t} --> {end_t}\n{sub_text}\n"

    # Primary approach: Match with script sentences
    start_time = -1.0
    sub_items = []
    sub_index = 0

    script_lines = utils.split_string_by_punctuations(text)
    
    logger.info(f"Attempting primary subtitle matching with {len(script_lines)} script lines")

    def match_line(_sub_line: str, _sub_index: int):
        """Enhanced matching with fuzzy logic."""
        if len(script_lines) <= _sub_index:
            return ""

        _line = script_lines[_sub_index]
        
        # Try exact match first
        if _sub_line == _line:
            logger.debug(f"Exact match found for line {_sub_index}")
            return script_lines[_sub_index].strip()

        # Try without punctuation
        _sub_line_ = re.sub(r"[^\w\s]", "", _sub_line)
        _line_ = re.sub(r"[^\w\s]", "", _line)
        if _sub_line_ == _line_:
            logger.debug(f"Punctuation-free match found for line {_sub_index}")
            return _line_.strip()

        # Try without all non-word characters
        _sub_line_ = re.sub(r"\W+", "", _sub_line)
        _line_ = re.sub(r"\W+", "", _line)
        if _sub_line_ == _line_:
            logger.debug(f"Non-word-free match found for line {_sub_index}")
            return _line.strip()
        
        # Try fuzzy matching
        similarity = _fuzzy_match_text(_sub_line, _line)
        if similarity >= 0.8:  # 80% similarity threshold
            logger.debug(f"Fuzzy match found for line {_sub_index} (similarity: {similarity:.2f})")
            return _line.strip()
        
        logger.debug(f"No match found for line {_sub_index} (similarity: {similarity:.2f})")
        return ""

    sub_line = ""

    try:
        for cue in sub_maker.cues:
            start_time_micro = cue.start.total_seconds() * 10000000
            end_time_micro = cue.end.total_seconds() * 10000000
            
            if start_time < 0:
                start_time = start_time_micro

            sub = unescape(cue.content)
            sub_line += sub
            sub_text = match_line(sub_line, sub_index)
            if sub_text:
                sub_index += 1
                line = formatter(
                    idx=sub_index,
                    start_time=start_time,
                    end_time=end_time_micro,
                    sub_text=sub_text,
                )
                sub_items.append(line)
                start_time = -1.0
                sub_line = ""

        # Check if primary matching succeeded
        if sub_items:
            logger.info(f"Primary matching succeeded: {len(sub_items)} subtitle items created")
            with open(subtitle_file, "w", encoding="utf-8") as file:
                file.write("\n".join(sub_items) + "\n")
            logger.info(f"subtitle created: {subtitle_file}")
        else:
            # Fallback: Use simple time-based grouping
            logger.warning("Primary matching failed, using fallback subtitle generation")
            sub_items = _create_fallback_subtitles(sub_maker)
            
            if sub_items:
                logger.info(f"Fallback succeeded: {len(sub_items)} subtitle items created")
                with open(subtitle_file, "w", encoding="utf-8") as file:
                    file.write("\n".join(sub_items) + "\n")
                logger.info(f"subtitle created (fallback): {subtitle_file}")
            else:
                logger.error("Both primary and fallback subtitle generation failed")

    except Exception as e:
        logger.error(f"subtitle creation failed: {str(e)}")




def _get_audio_duration_from_submaker(sub_maker: submaker.SubMaker) -> float:
    """Get audio duration from SubMaker timing data."""
    if not sub_maker.cues:
        return 0.0
    return sub_maker.cues[-1].end.total_seconds()


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
