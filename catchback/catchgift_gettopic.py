"""
Quick script to find 生日礼物 topic ID.
"""
import asyncio
from telethon import TelegramClient
from telethon.tl.functions.messages import GetForumTopicsRequest

API_ID     = 35533633
API_HASH   = "1e2eebfd53ef0c4b9c6a5b163ca71f3c"
GROUP_NAME = "t.me/+3lZmmEKB0rhiNTU1"

async def main():
    async with TelegramClient("catchgift_session", API_ID, API_HASH) as client:
        print("Logged in")
        group = await client.get_entity(GROUP_NAME)
        print(f"Group: {group.title}\n")

        result = await client(GetForumTopicsRequest(
            peer=group, offset_date=0, offset_id=0,
            offset_topic=0, limit=100, q=""
        ))
        print(f"{'ID':<12} Topic Name")
        print(f"{'-'*12} {'-'*40}")
        for t in result.topics:
            print(f"{t.id:<12} {t.title}")

asyncio.run(main())
