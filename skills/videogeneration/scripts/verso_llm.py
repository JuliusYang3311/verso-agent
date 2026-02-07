#!/usr/bin/env python3
"""
Verso LLM integration for video generation skill.
Calls Verso via `verso agent --local` command which uses configured provider/model.
"""

import json
import os
import re
import subprocess
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
    Call Verso agent CLI for LLM response.
    Uses `verso agent -m "prompt" --local --json` to invoke with configured provider.
    
    Args:
        prompt: The prompt to send to the LLM
        timeout: Timeout in seconds
    
    Returns:
        The LLM response text
    """
    verso_dir = get_verso_dir()
    
    try:
        result = subprocess.run(
            ["pnpm", "verso", "agent", "-m", prompt, "--local", "--json"],
            cwd=verso_dir,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.returncode == 0:
            # Parse JSON output
            try:
                output = result.stdout.strip()
                # Find JSON in output (skip non-JSON lines)
                for line in output.split('\n'):
                    line = line.strip()
                    if line.startswith('{'):
                        data = json.loads(line)
                        # Extract response text from payloads
                        payloads = data.get('payloads', [])
                        texts = [p.get('text', '') for p in payloads if isinstance(p, dict)]
                        return '\n'.join(texts).strip()
                # Fallback: return raw output
                return output
            except json.JSONDecodeError:
                # Return raw stdout if not JSON
                return result.stdout.strip()
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
    paragraph_number: int = 1
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
    lang_hint = f"in {language}" if language and language != "en" else ""
    
    prompt = f"""Write a short video narration script about: {video_subject}

Requirements:
- Write exactly {paragraph_number} paragraph(s) {lang_hint}
- Get straight to the main content immediately
- No greetings like "welcome" or "in this video"
- No markdown formatting, plain text only
- No speaker labels like "voiceover:" or "narrator:"
- Just the script text, nothing else

Return only the script:"""

    result = call_verso_agent(prompt)
    
    if not result:
        # Fallback placeholder
        result = f"This is a video about {video_subject}. "
        result += "It explores the topic in an engaging and informative way."
    
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
    script_preview = video_script[:500] if video_script else video_subject
    
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
