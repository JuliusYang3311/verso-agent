import os
import random
from typing import List
from urllib.parse import urlencode

import requests
from loguru import logger
from moviepy.video.io.VideoFileClip import VideoFileClip

from .config import config
from .schema import MaterialInfo, VideoAspect, VideoConcatMode
from . import utils

requested_count = 0


def filter_by_quality(
    video_items: List[MaterialInfo],
    minimum_duration: int
) -> List[MaterialInfo]:
    """
    Filter and sort videos by quality metrics.
    Prefers longer, higher-quality clips.
    
    Args:
        video_items: List of video materials
        minimum_duration: Minimum acceptable duration
    
    Returns:
        Filtered and sorted list of materials
    """
    if not video_items:
        return []
    
    # Score each video
    scored_items = []
    for item in video_items:
        score = 0.0
        
        # Prefer videos between 10-30 seconds (ideal for b-roll)
        if 10 <= item.duration <= 30:
            score += 10
        elif 8 <= item.duration <= 40:
            score += 5
        elif item.duration >= minimum_duration:
            score += 2
        
        # Bonus for longer clips (more flexibility in editing)
        if item.duration >= 15:
            score += 3
        
        scored_items.append((score, item))
    
    # Sort by score (highest first)
    scored_items.sort(key=lambda x: x[0], reverse=True)
    
    # Return top 70% of results
    cutoff = max(1, int(len(scored_items) * 0.7))
    return [item for score, item in scored_items[:cutoff]]


def calculate_diversity_score(
    existing_videos: List[MaterialInfo],
    new_video: MaterialInfo,
    threshold: float = 0.3
) -> float:
    """
    Calculate how different a new video is from existing selections.
    
    Args:
        existing_videos: Already selected videos
        new_video: Candidate video to evaluate
        threshold: Minimum diversity score to consider (0-1)
    
    Returns:
        Diversity score (0-1, higher = more different)
    """
    if not existing_videos:
        return 1.0
    
    diversity_scores = []
    
    for existing in existing_videos:
        score = 0.0
        
        # Different duration ranges suggest different content
        duration_diff = abs(existing.duration - new_video.duration)
        if duration_diff > 10:
            score += 0.4
        elif duration_diff > 5:
            score += 0.2
        
        # Different providers might have different content
        if existing.provider != new_video.provider:
            score += 0.3
        
        # Different URLs are obviously different videos
        if existing.url != new_video.url:
            score += 0.3
        
        diversity_scores.append(score)
    
    # Return average diversity score
    return sum(diversity_scores) / len(diversity_scores) if diversity_scores else 1.0


def get_api_key(cfg_key: str):
    api_keys = config.app.get(cfg_key)
    if not api_keys:
        raise ValueError(
            f"\n\n##### {cfg_key} is not set #####\n\nPlease set it in the config.toml file: {config.config_file}\n\n"
            f"{utils.to_json(config.app)}"
        )

    # if only one key is provided, return it
    if isinstance(api_keys, str):
        return api_keys

    global requested_count
    requested_count += 1
    return api_keys[requested_count % len(api_keys)]


def search_videos_pexels(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
    quality_filter: bool = True,
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)
    video_orientation = aspect.name
    video_width, video_height = aspect.to_resolution()
    api_key = get_api_key("pexels_api_keys")
    headers = {
        "Authorization": api_key,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    }
    # Build URL - request more results for better filtering
    params = {"query": search_term, "per_page": 50, "orientation": video_orientation}
    query_url = f"https://api.pexels.com/videos/search?{urlencode(params)}"
    logger.info(f"searching videos: {query_url}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url,
            headers=headers,
            proxies=config.proxy,
            verify=False,
            timeout=(30, 60),
        )
        response = r.json()
        video_items = []
        if "videos" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["videos"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["video_files"]
            # loop through each url to determine the best quality
            for video in video_files:
                w = int(video["width"])
                h = int(video["height"])
                if w == video_width and h == video_height:
                    item = MaterialInfo()
                    item.provider = "pexels"
                    item.url = video["link"]
                    item.duration = duration
                    video_items.append(item)
                    break
        
        # Apply quality filtering if enabled
        if quality_filter and video_items:
            video_items = filter_by_quality(video_items, minimum_duration)
        
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def search_videos_pixabay(
    search_term: str,
    minimum_duration: int,
    video_aspect: VideoAspect = VideoAspect.portrait,
    quality_filter: bool = True,
) -> List[MaterialInfo]:
    aspect = VideoAspect(video_aspect)

    video_width, video_height = aspect.to_resolution()

    api_key = get_api_key("pixabay_api_keys")
    # Build URL
    params = {
        "q": search_term,
        "video_type": "all",  # Accepted values: "all", "film", "animation"
        "per_page": 50,
        "key": api_key,
    }
    query_url = f"https://pixabay.com/api/videos/?{urlencode(params)}"
    logger.info(f"searching videos: {query_url}, with proxies: {config.proxy}")

    try:
        r = requests.get(
            query_url, proxies=config.proxy, verify=False, timeout=(30, 60)
        )
        response = r.json()
        video_items = []
        if "hits" not in response:
            logger.error(f"search videos failed: {response}")
            return video_items
        videos = response["hits"]
        # loop through each video in the result
        for v in videos:
            duration = v["duration"]
            # check if video has desired minimum duration
            if duration < minimum_duration:
                continue
            video_files = v["videos"]
            # loop through each url to determine the best quality
            for video_type in video_files:
                video = video_files[video_type]
                w = int(video["width"])
                # h = int(video["height"])
                if w >= video_width:
                    item = MaterialInfo()
                    item.provider = "pixabay"
                    item.url = video["url"]
                    item.duration = duration
                    video_items.append(item)
                    break
        
        # Apply quality filtering if enabled
        if quality_filter and video_items:
            video_items = filter_by_quality(video_items, minimum_duration)
        
        return video_items
    except Exception as e:
        logger.error(f"search videos failed: {str(e)}")

    return []


def save_video(video_url: str, save_dir: str = "") -> str:
    if not save_dir:
        save_dir = utils.storage_dir("cache_videos")

    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    url_without_query = video_url.split("?")[0]
    url_hash = utils.md5(url_without_query)
    video_id = f"vid-{url_hash}"
    video_path = f"{save_dir}/{video_id}.mp4"

    # if video already exists, return the path
    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        logger.info(f"video already exists: {video_path}")
        return video_path

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    }

    # if video does not exist, download it
    with open(video_path, "wb") as f:
        f.write(
            requests.get(
                video_url,
                headers=headers,
                proxies=config.proxy,
                verify=False,
                timeout=(60, 240),
            ).content
        )

    if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
        try:
            clip = VideoFileClip(video_path)
            duration = clip.duration
            fps = clip.fps
            clip.close()
            if duration > 0 and fps > 0:
                return video_path
        except Exception as e:
            try:
                os.remove(video_path)
            except Exception:
                pass
            logger.warning(f"invalid video file: {video_path} => {str(e)}")
    return ""


def download_videos(
    task_id: str,
    search_terms: List[str],
    source: str = "pexels",
    video_aspect: VideoAspect = VideoAspect.portrait,
    video_contact_mode: VideoConcatMode = VideoConcatMode.random,
    audio_duration: float = 0.0,
    max_clip_duration: int = 5,
    quality_filter: bool = True,
    diversity_threshold: float = 0.3,
) -> List[str]:
    valid_video_items = []
    valid_video_urls = []
    found_duration = 0.0
    search_videos = search_videos_pexels
    if source == "pixabay":
        search_videos = search_videos_pixabay

    for search_term in search_terms:
        video_items = search_videos(
            search_term=search_term,
            minimum_duration=max_clip_duration,
            video_aspect=video_aspect,
            quality_filter=quality_filter,
        )
        logger.info(f"found {len(video_items)} videos for '{search_term}'")

        for item in video_items:
            if item.url not in valid_video_urls:
                # Apply diversity check if enabled
                if diversity_threshold > 0:
                    diversity_score = calculate_diversity_score(
                        valid_video_items, item, diversity_threshold
                    )
                    if diversity_score < diversity_threshold:
                        logger.info(f"skipping similar video (diversity: {diversity_score:.2f}): {item.url[:50]}")
                        continue
                
                valid_video_items.append(item)
                valid_video_urls.append(item.url)
                found_duration += item.duration

    logger.info(
        f"found total videos: {len(valid_video_items)}, required duration: {audio_duration} seconds, found duration: {found_duration} seconds"
    )
    video_paths = []

    material_directory = config.app.get("material_directory", "").strip()
    if material_directory == "task":
        material_directory = utils.task_dir(task_id)
    elif material_directory and not os.path.isdir(material_directory):
        material_directory = ""

    if video_contact_mode.value == VideoConcatMode.random.value:
        random.shuffle(valid_video_items)

    total_duration = 0.0
    for item in valid_video_items:
        try:
            logger.info(f"downloading video: {item.url}")
            saved_video_path = save_video(
                video_url=item.url, save_dir=material_directory
            )
            if saved_video_path:
                logger.info(f"video saved: {saved_video_path}")
                video_paths.append(saved_video_path)
                
                # Calculate usable duration: since we only use ONE segment per video,
                # count only max_clip_duration toward total, not full video duration
                usable_duration = min(max_clip_duration, item.duration)
                total_duration += usable_duration
                
                # Add 20% buffer to account for potential download failures
                required_duration = audio_duration * 1.2
                if total_duration >= required_duration:
                    logger.info(
                        f"downloaded sufficient videos: {total_duration:.2f}s >= {required_duration:.2f}s (audio: {audio_duration:.2f}s)"
                    )
                    break
        except Exception as e:
            logger.error(f"failed to download video: {utils.to_json(item)} => {str(e)}")
    logger.success(f"downloaded {len(video_paths)} videos")
    return video_paths


if __name__ == "__main__":
    download_videos(
        "test123", ["Money Exchange Medium"], audio_duration=100, source="pixabay"
    )
