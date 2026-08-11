from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.models import MistralModel
from talentsift_ai.schemas import CVStructure

EXTRACTION_SYSTEM_PROMPT = """
You extract normalized candidate data from resume text.
Return only fields supported by the schema. Normalize GPA to a 4.00 scale when possible.
If the candidate graduated, set current_class to 5.
Use 0 for experience_years when no relevant software or work experience is evident.
"""


async def extract_cv_structure(client: MistralClient, raw_cv_text: str) -> CVStructure:
    return await client.chat_json(
        model=MistralModel.EXTRACTION,
        system_prompt=EXTRACTION_SYSTEM_PROMPT.strip(),
        user_prompt=f"Resume text:\n\n{raw_cv_text}",
        response_model=CVStructure,
        temperature=0.0,
    )

