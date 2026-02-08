#!/usr/bin/env python3
"""
Verso LLM integration for video generation skill.
Calls Verso via `verso agent --local` command which uses configured provider/model.
"""

import json
import os
import re
import subprocess
import uuid
from typing import List, Optional


def get_verso_dir() -> str:
    """Get the Verso installation directory."""
    # Check environment variable first
    verso_dir = os.environ.get("VERSO_DIR")
    if verso_dir and os.path.exists(verso_dir):
        return verso_dir
    
    # Default locations
    default_paths = [
        os.path.expanduser("~/Documents/verso"),
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    ]
    
    for path in default_paths:
        if os.path.exists(os.path.join(path, "package.json")):
            return path
    
    return default_paths[0]


def call_verso_agent(prompt: str, timeout: int = 120) -> str:
    """
    Call Verso agent CLI for LLM response with isolated session.
    Uses `verso agent -m "prompt" --session-id <uuid> --local --json`.
    
    Args:
        prompt: The prompt to send to the LLM
        timeout: Timeout in seconds
    
    Returns:
        The LLM response text
    """
    verso_dir = get_verso_dir()
    
    # Generate isolated session ID for each call
    session_id = str(uuid.uuid4())
    
    try:
        result = subprocess.run(
            [
                "pnpm", "verso", "agent",
                "-m", prompt,
                "--agent", "utility",
                "--session-id", session_id,
                "--local",
                "--json"
            ],
            cwd=verso_dir,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.returncode == 0:
            output = result.stdout.strip()
            
            # Find JSON block in output
            # Look for the last matching pair of curly braces that forms a valid JSON object
            json_match = re.search(r'(\{.*\})', output, re.DOTALL)
            if json_match:
                try:
                    data = json.loads(json_match.group(1))
                    # Extract response text from payloads
                    payloads = data.get('payloads', [])
                    texts = [p.get('text', '') for p in payloads if isinstance(p, dict)]
                    return '\n'.join(texts).strip()
                except json.JSONDecodeError:
                    pass
            
            # Fallback for non-JSON output
            return output
        else:
            print(f"⚠️  Verso agent error: {result.stderr}")
            return ""
            
    except subprocess.TimeoutExpired:
        print("❌ Verso agent timeout")
        return ""
    except FileNotFoundError:
        print("❌ Verso agent not found - make sure pnpm is installed")
        return ""
    except Exception as e:
        print(f"❌ Verso agent error: {e}")
        return ""


def generate_script(
    video_subject: str,
    language: str = "en",
    paragraph_number: int = 5
) -> str:
    """
    Generate a video script for the given subject using Verso LLM.
    
    Args:
        video_subject: Topic for the video
        language: Language code (e.g., "en", "zh")
        paragraph_number: Number of paragraphs to generate
    
    Returns:
        Generated script text
    """
    # Determine language for the prompt
    if language and language.startswith("zh"):
        lang_instruction = "用中文写作"
        word_count = "400-600字"
    else:
        lang_instruction = f"Write in {language}" if language else ""
        word_count = "300-500 words"
    
    prompt = f"""You are a professional video scriptwriter. Expand and write a detailed, engaging video narration script about: {video_subject}

Instructions:
1. {lang_instruction}
2. Write {paragraph_number} rich, detailed paragraphs totaling {word_count}
3. Start with an attention-grabbing opening that hooks the viewer
4. Expand on the topic with interesting facts, insights, or perspectives
5. Include specific details, examples, or scenarios to make it vivid
6. End with a memorable conclusion or call-to-action
7. Use a conversational, engaging tone suitable for voiceover
8. NO greetings like "welcome" or "in this video"
9. NO markdown formatting, plain text only
10. NO speaker labels, just the script text

Write the complete script now:"""

    result = call_verso_agent(prompt, timeout=180)
    
    if not result or len(result) < 100:
        # Fallback with more content
        if language and language.startswith("zh"):
            result = f"{video_subject}是一个非常重要的话题。让我们一起来探索它的方方面面。"
            result += f"无论是在日常生活还是在专业领域，{video_subject}都发挥着重要的作用。"
            result += "通过深入了解这个主题，我们可以获得新的见解和启发。"
        else:
            result = f"{video_subject} is a fascinating topic that deserves our attention. "
            result += "Let's explore what makes it so important and how it impacts our world. "
            result += "Understanding this topic opens up new perspectives and opportunities for everyone."
    
    return result.strip()



def generate_terms(
    video_subject: str,
    video_script: str,
    amount: int = 5
) -> List[str]:
    """
    Generate search terms for stock video footage using Verso LLM.
    
    Args:
        video_subject: Topic of the video
        video_script: The video script content
        amount: Number of search terms to generate
    
    Returns:
        List of search terms
    """
    script_preview = video_script if video_script else video_subject
    
    prompt = f"""Generate {amount} search terms for stock video footage.

Video topic: {video_subject}

Script:
{script_preview}

Requirements:
- Return ONLY a JSON array of strings like ["term1", "term2"]
- Each term should be 1-3 words
- Terms must be in English (for stock video APIs)
- Terms should visually represent the video content

Return the JSON array:"""

    result = call_verso_agent(prompt, timeout=60)
    
    # Parse JSON response
    if result:
        try:
            # Find JSON array in response
            json_match = re.search(r'\[.*?\]', result, re.DOTALL)
            if json_match:
                terms = json.loads(json_match.group())
                if isinstance(terms, list):
                    return [str(t).strip() for t in terms[:amount] if t]
        except (json.JSONDecodeError, TypeError):
            pass
    
    # Fallback: generate terms from subject
    fallback_words = video_subject.lower().split()
    fallback_terms = [w for w in fallback_words if len(w) > 2][:amount]
    return fallback_terms if fallback_terms else ["nature", "technology", "business"]


if __name__ == "__main__":
    # Test
    subject = "artificial intelligence in healthcare"
    
    print("Testing generate_script...")
    script = generate_script(subject, "en", 2)
    print(f"Script:\n{script}\n")
    
    print("Testing generate_terms...")
    terms = generate_terms(subject, script, 5)
    print(f"Terms: {terms}")
