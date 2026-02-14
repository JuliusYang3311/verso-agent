import sys
import os
import shutil
import json
from pathlib import Path

# Add the skills path to sys.path
SKILLS_ROOT = "/Users/veso/Documents/verso/skills/videogeneration"
sys.path.insert(0, SKILLS_ROOT)

from scripts.schema import VideoParams, VideoAspect, VideoConcatMode, MaterialInfo
from scripts import voice, video

def generate_fixed_s3():
    topic = "Verso Detective Section 3"
    script = "这座标志性的蓝色圆顶建筑，外界称之为‘神庙’。但在这座建筑的地下，埋藏着爱泼斯坦网络最核心的秘密。它并非琴房，而是物理意义上的信号基站。注意看它的天线构造。解密文件显示，圣詹姆斯岛的海底布满了绝密传感器，全天候监控着每一艘进出的船只。每一间卧室，甚至每一面镜子背后，都有隐藏摄像头，实时捕捉着那些权贵的丑恶瞬间。这些数据通过神庙的卫星天线流向远方。这种监视协议，后来成为了硅谷某些全球监测系统的Beta测试版。真相，永远比你想象的更冰冷。"
    
    output_dir = "/Users/veso/Documents/verso/video_generation"
    task_dir = os.path.join(output_dir, "task-verso-detective-s3-final-fix")
    os.makedirs(task_dir, exist_ok=True)
    
    final_output = "/Users/veso/Documents/verso/video_generation/verso_detective_s3_fixed.mp4"
    
    # 1. Generate Audio
    print("🎙️ Generating audio...")
    audio_file = os.path.join(task_dir, "audio.mp3")
    sub_maker = voice.tts(
        text=script,
        voice_name="zh-CN-YunxiNeural",
        voice_rate=1.0,
        voice_file=audio_file
    )
    audio_duration = voice.get_audio_duration(audio_file)
    print(f"Audio duration: {audio_duration}s")
    
    # 2. Generate Subtitles
    print("📝 Generating subtitles...")
    subtitle_file = os.path.join(task_dir, "subtitle.srt")
    voice.create_subtitle(sub_maker, script, subtitle_file)
    
    # 3. Prepare Materials (Image to Video with Ken Burns)
    # Alignment: 0-15s, 15-30s, 30-50s, 50-70s, 70-end
    materials_config = [
        {"path": "/Users/veso/Documents/verso/assets/epstein_assets/blue_temple_exterior.jpg", "duration": 15},
        {"path": "/Users/veso/Documents/verso/assets/epstein_assets/blue_temple_stripes.jpg", "duration": 15},
        {"path": "/Users/veso/Documents/verso/assets/epstein_assets/surveillance_overview.mp4", "duration": 20},
        {"path": "/Users/veso/Documents/verso/assets/epstein_assets/surveillance_bedroom.mp4", "duration": 20},
        {"path": "/Users/veso/Documents/verso/assets/epstein_assets/satellite.mp4", "duration": 20}
    ]
    
    print("🎬 Processing materials...")
    from moviepy import ImageClip, VideoFileClip, CompositeVideoClip, concatenate_videoclips
    from moviepy.video.fx import Loop
    
    clips = []
    for i, item in enumerate(materials_config):
        src = item["path"]
        dur = item["duration"]
        print(f"Processing {os.path.basename(src)}...")
        
        if src.endswith(".jpg"):
            clip = ImageClip(src).with_duration(dur).with_position("center")
            # 15% zoom
            zoom_clip = clip.resized(lambda t: 1 + (0.15 * (t / clip.duration)))
            # Ensure it fits 1080p landscape
            zoom_clip = zoom_clip.resized(new_size=(1920, 1080))
            clips.append(zoom_clip)
        else:
            v_clip = VideoFileClip(src)
            # Loop if shorter than desired duration
            if v_clip.duration < dur:
                v_clip = v_clip.with_effects([Loop(duration=dur)])
            else:
                v_clip = v_clip.subclipped(0, dur)
            v_clip = v_clip.resized(new_size=(1920, 1080))
            clips.append(v_clip)
            
    # Combine materials
    print("🎥 Stitching clips...")
    full_video = concatenate_videoclips(clips, method="compose")
    # Trim to audio duration exactly
    full_video = full_video.subclipped(0, audio_duration)
    
    # 4. Final Assembly
    print("✨ Final assembly with audio and subtitles...")
    params = VideoParams(
        video_subject=topic,
        video_script=script,
        video_aspect=VideoAspect.landscape,
        subtitle_enabled=True,
        voice_name="zh-CN-YunxiNeural"
    )
    params.font_name = "Arial Unicode.ttf"
    
    # Use moviepy directly for final write to ensure it works
    from moviepy.video.tools.subtitles import SubtitlesClip
    from moviepy import TextClip
    
    def make_textclip(text):
        return TextClip(
            text=text,
            font="/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            font_size=60,
            color='white',
            stroke_color='black',
            stroke_width=2,
            method='caption',
            size=(int(1920*0.8), None)
        ).with_position(('center', int(1080*0.85)))

    sub = SubtitlesClip(subtitle_file, make_textclip=make_textclip, encoding='utf-8')
    final_clip = CompositeVideoClip([full_video, sub.with_start(0)])
    final_clip = final_clip.with_audio(voice.AudioFileClip(audio_file))
    
    final_clip.write_videofile(final_output, fps=30, codec="libx264", audio_codec="aac", threads=1)
    
    print(f"✅ Final video generated at: {final_output}")

if __name__ == "__main__":
    generate_fixed_s3()
