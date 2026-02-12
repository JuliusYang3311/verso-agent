#!/usr/bin/env python3
"""
Twitter Auto-Post Script for Verso
Posts tweets with text, images, videos, and thread support.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import List, Optional

try:
    import tweepy
except ImportError:
    print("Error: tweepy is not installed. Run: pip install tweepy")
    sys.exit(1)


def load_config() -> dict:
    """Load Twitter API credentials from verso.json"""
    # Try environment variables first
    env_config = {
        'api_key': os.environ.get('TWITTER_API_KEY'),
        'api_secret': os.environ.get('TWITTER_API_SECRET'),
        'access_token': os.environ.get('TWITTER_ACCESS_TOKEN'),
        'access_secret': os.environ.get('TWITTER_ACCESS_SECRET'),
    }
    
    # If all present in env, return immediately
    if all(env_config.values()):
        return env_config

    config_path = Path.home() / ".verso" / "verso.json"
    
    if not config_path.exists():
        print(f"Error: Configuration file not found at {config_path}")
        print("Run 'verso configure' to set up your Twitter credentials.")
        sys.exit(1)
    
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        # Extract Twitter credentials - match the TwitterConfig type names
        file_config = {
            'api_key': config.get('twitter', {}).get('apiKey'),
            'api_secret': config.get('twitter', {}).get('apiSecret'),
            'access_token': config.get('twitter', {}).get('accessToken'),
            'access_secret': config.get('twitter', {}).get('accessSecret'),
        }
        
        # Merge env config over file config (though env should have taken precedence if complete)
        # This handles cases where only SOME env vars might be set (partial override)
        final_config = {
            k: env_config.get(k) or file_config.get(k)
            for k in env_config.keys()
        }
        
        # Validate credentials
        missing = [k for k, v in final_config.items() if not v]
        if missing:
            print(f"Error: Missing Twitter credentials: {', '.join(missing)}")
            print("Run 'verso configure' to set up your Twitter API keys.")
            sys.exit(1)
        
        return final_config
    
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse {config_path}: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error loading configuration: {e}")
        sys.exit(1)


def create_twitter_client(config: dict) -> tweepy.Client:
    """Create and authenticate Twitter API client"""
    try:
        # Create Twitter API v2 client
        client = tweepy.Client(
            consumer_key=config['api_key'],
            consumer_secret=config['api_secret'],
            access_token=config['access_token'],
            access_token_secret=config['access_secret']
        )
        
        # Test authentication
        client.get_me()
        return client
        
    except tweepy.Unauthorized:
        print("Error: Authentication failed. Check your API credentials.")
        sys.exit(1)
    except tweepy.Forbidden as e:
        print(f"Error: Access forbidden. Make sure your app has Read and Write permissions: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error creating Twitter client: {e}")
        sys.exit(1)


def upload_media(config: dict, media_paths: List[str]) -> List[str]:
    """Upload media files and return media IDs"""
    if not media_paths:
        return []
    
    # For media upload, we need API v1.1
    auth = tweepy.OAuth1UserHandler(
        config['api_key'],
        config['api_secret'],
        config['access_token'],
        config['access_secret']
    )
    api = tweepy.API(auth)
    
    media_ids = []
    
    for media_path in media_paths:
        if not os.path.exists(media_path):
            print(f"Warning: Media file not found: {media_path}")
            continue
        
        try:
            print(f"Uploading {media_path}...")
            ext = os.path.splitext(media_path)[1].lower()
            is_video = ext in {'.mp4', '.mov', '.avi', '.mkv'}
            if is_video:
                # Use chunked upload + wait for async finalize to avoid invalid media IDs
                media = api.media_upload(
                    filename=media_path,
                    chunked=True,
                    media_category='tweet_video',
                    wait_for_async_finalize=True
                )
            else:
                media = api.media_upload(filename=media_path)
            media_ids.append(media.media_id_string)
            print(f"✓ Uploaded: {os.path.basename(media_path)}")
        except Exception as e:
            print(f"Error uploading {media_path}: {e}")
            continue
    
    return media_ids


def post_tweet(client: tweepy.Client, text: str, media_ids: Optional[List[str]] = None) -> Optional[dict]:
    """Post a single tweet"""
    try:
        kwargs = {'text': text}
        if media_ids:
            kwargs['media_ids'] = media_ids
        
        response = client.create_tweet(**kwargs)
        return response.data
    except tweepy.TweepyException as e:
        print(f"Error posting tweet: {e}")
        return None


def post_thread(client: tweepy.Client, tweets: List[str], media_ids: Optional[List[str]] = None) -> bool:
    """Post a thread of tweets"""
    previous_tweet_id = None
    
    for i, tweet_text in enumerate(tweets):
        try:
            kwargs = {'text': tweet_text}
            
            # Add media only to first tweet
            if i == 0 and media_ids:
                kwargs['media_ids'] = media_ids
            
            # Reply to previous tweet
            if previous_tweet_id:
                kwargs['in_reply_to_tweet_id'] = previous_tweet_id
            
            response = client.create_tweet(**kwargs)
            previous_tweet_id = response.data['id']
            
            print(f"✓ Posted tweet {i+1}/{len(tweets)}")
            
        except tweepy.TweepyException as e:
            print(f"Error posting tweet {i+1}: {e}")
            return False
    
    return True


def main():
    parser = argparse.ArgumentParser(
        description='Post tweets to Twitter/X',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Simple tweet
  %(prog)s "Hello World!"
  
  # Tweet with image
  %(prog)s "Check this out!" --media image.jpg
  
  # Thread
  %(prog)s --thread "Tweet 1" --thread "Tweet 2" --thread "Tweet 3"
  
  # Tweet with multiple images
  %(prog)s "Gallery" --media img1.jpg img2.jpg img3.jpg
        '''
    )
    
    parser.add_argument(
        'text',
        nargs='?',
        help='Tweet text (not required if using --thread)'
    )
    
    parser.add_argument(
        '--media',
        nargs='+',
        metavar='FILE',
        help='Path(s) to image or video files (up to 4 images or 1 video)'
    )
    
    parser.add_argument(
        '--thread',
        action='append',
        metavar='TEXT',
        help='Create a thread. Use multiple times for each tweet in the thread.'
    )
    
    args = parser.parse_args()
    
    # Validate arguments
    if not args.text and not args.thread:
        parser.error("Either provide tweet text or use --thread option")
    
    if args.text and args.thread:
        parser.error("Cannot use both positional text and --thread option")
    
    # Load configuration and create client
    print("Loading Twitter configuration...")
    config = load_config()
    
    print("Authenticating with Twitter...")
    client = create_twitter_client(config)
    
    # Upload media if provided
    media_ids = None
    if args.media:
        media_ids = upload_media(config, args.media)
        if not media_ids:
            print("Warning: No media files were successfully uploaded")
    
    # Post tweet or thread
    if args.thread:
        print(f"\nPosting thread ({len(args.thread)} tweets)...")
        success = post_thread(client, args.thread, media_ids)
        if success:
            print("\n✅ Thread posted successfully!")
        else:
            print("\n❌ Failed to post complete thread")
            sys.exit(1)
    else:
        print(f"\nPosting tweet...")
        result = post_tweet(client, args.text, media_ids)
        if result:
            tweet_id = result['id']
            print(f"\n✅ Tweet posted successfully!")
            print(f"View at: https://twitter.com/i/web/status/{tweet_id}")
        else:
            print("\n❌ Failed to post tweet")
            sys.exit(1)


if __name__ == '__main__':
    main()
