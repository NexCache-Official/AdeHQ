/**
 * Standardize call voices by gender. Talking style (tone/pace) stays separate;
 * gender only picks the male/female voice pool (with auto-from-first-name).
 */

export type VoiceGender = "female" | "male";
export type VoiceGenderMode = "auto" | "female" | "male";

export const XAI_FEMALE_VOICES = ["eve", "ara"] as const;
export const XAI_MALE_VOICES = ["leo", "rex", "sal"] as const;

export const COSY_FEMALE_VOICES = [
  "FunAudioLLM/CosyVoice2-0.5B:anna",
  "FunAudioLLM/CosyVoice2-0.5B:bella",
  "FunAudioLLM/CosyVoice2-0.5B:claire",
  "FunAudioLLM/CosyVoice2-0.5B:diana",
] as const;

export const COSY_MALE_VOICES = [
  "FunAudioLLM/CosyVoice2-0.5B:alex",
  "FunAudioLLM/CosyVoice2-0.5B:benjamin",
  "FunAudioLLM/CosyVoice2-0.5B:charles",
  "FunAudioLLM/CosyVoice2-0.5B:david",
] as const;

/** Common first-name → gender map for AdeHQ employee naming. */
const FEMALE_FIRST_NAMES = new Set(
  [
    "priya",
    "maya",
    "elena",
    "sophia",
    "sofia",
    "olivia",
    "emma",
    "ava",
    "mia",
    "amelia",
    "harper",
    "evelyn",
    "abigail",
    "emily",
    "elizabeth",
    "sofia",
    "ella",
    "scarlett",
    "grace",
    "chloe",
    "victoria",
    "riley",
    "aria",
    "lily",
    "aurora",
    "zoey",
    "penelope",
    "layla",
    "nora",
    "camila",
    "hanna",
    "hannah",
    "addison",
    "eleanor",
    "natalie",
    "luna",
    "savannah",
    "leah",
    "stella",
    "hazel",
    "violet",
    "aurora",
    "lucy",
    "paisley",
    "anna",
    "bella",
    "claire",
    "diana",
    "sara",
    "sarah",
    "jessica",
    "jennifer",
    "amanda",
    "nicole",
    "rachel",
    "lauren",
    "megan",
    "samantha",
    "ashley",
    "katherine",
    "catherine",
    "maria",
    "ana",
    "isabella",
    "zoe",
    "zara",
    "aisha",
    "fatima",
    "yasmin",
    "leila",
    "nadia",
    "amira",
    "sienna",
    "ivy",
    "ruby",
    "alice",
    "julia",
    "julie",
    "christine",
    "christina",
    "michelle",
    "kimberly",
    "stephanie",
    "rebecca",
    "laura",
    "heather",
    "angela",
    "melissa",
    "amy",
    "lisa",
    "karen",
    "susan",
    "nancy",
    "betty",
    "margaret",
    "sandra",
    "ashley",
    "kim",
    "donna",
    "carol",
    "ruth",
    "sharon",
    "michelle",
    "priyanka",
    "ananya",
    "isha",
    "neha",
    "kavya",
    "meera",
    "riya",
    "anjali",
  ].map((name) => name.toLowerCase()),
);

const MALE_FIRST_NAMES = new Set(
  [
    "david",
    "james",
    "john",
    "robert",
    "michael",
    "william",
    "richard",
    "joseph",
    "thomas",
    "charles",
    "daniel",
    "matthew",
    "anthony",
    "mark",
    "donald",
    "steven",
    "paul",
    "andrew",
    "joshua",
    "kenneth",
    "kevin",
    "brian",
    "george",
    "timothy",
    "ronald",
    "edward",
    "jason",
    "jeffrey",
    "ryan",
    "jacob",
    "gary",
    "nicholas",
    "eric",
    "jonathan",
    "stephen",
    "larry",
    "justin",
    "scott",
    "brandon",
    "benjamin",
    "samuel",
    "raymond",
    "gregory",
    "frank",
    "alexander",
    "patrick",
    "jack",
    "dennis",
    "jerry",
    "tyler",
    "aaron",
    "jose",
    "adam",
    "nathan",
    "henry",
    "douglas",
    "zachary",
    "peter",
    "kyle",
    "noah",
    "ethan",
    "jeremy",
    "walter",
    "christian",
    "keith",
    "roger",
    "terry",
    "austin",
    "sean",
    "gerald",
    "carl",
    "harold",
    "dylan",
    "arthur",
    "lawrence",
    "jordan",
    "jesse",
    "bryan",
    "billy",
    "bruce",
    "gabriel",
    "joe",
    "logan",
    "albert",
    "willie",
    "alan",
    "eugene",
    "russell",
    "vincent",
    "philip",
    "bobby",
    "johnny",
    "bradley",
    "shubham",
    "arjun",
    "rahul",
    "amit",
    "vikram",
    "rohan",
    "aditya",
    "karan",
    "sanjay",
    "raj",
    "dev",
    "leo",
    "rex",
    "sal",
    "alex",
    "max",
    "sam",
    "chris",
    "mike",
    "tom",
    "ben",
    "oliver",
    "liam",
    "lucas",
    "mason",
    "logan",
    "elijah",
    "aiden",
    "carter",
    "owen",
    "wyatt",
    "luke",
    "jayden",
    "julian",
    "levi",
    "isaac",
    "lincoln",
    "jaxon",
    "asher",
    "theodore",
    "caleb",
    "ryan",
    "nathan",
    "thomas",
    "leo",
  ].map((name) => name.toLowerCase()),
);

export function firstNameFromEmployeeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0]?.replace(/[^A-Za-z'-]/g, "") ?? "";
}

export function inferVoiceGenderFromName(name: string): VoiceGender {
  const first = firstNameFromEmployeeName(name).toLowerCase();
  if (!first) return "female";
  if (FEMALE_FIRST_NAMES.has(first)) return "female";
  if (MALE_FIRST_NAMES.has(first)) return "male";
  // Soft endings common for feminine given names when unknown.
  if (/(?:a|elle|ette|ine|lyn|ie|y)$/i.test(first) && first.length > 2) {
    return "female";
  }
  return "male";
}

export function resolveVoiceGender(input: {
  genderMode?: VoiceGenderMode | null;
  employeeName?: string | null;
}): VoiceGender {
  const mode = input.genderMode ?? "auto";
  if (mode === "female" || mode === "male") return mode;
  return inferVoiceGenderFromName(input.employeeName ?? "");
}

export function xaiVoicesForGender(gender: VoiceGender): readonly string[] {
  return gender === "female" ? XAI_FEMALE_VOICES : XAI_MALE_VOICES;
}

export function cosyVoicesForGender(gender: VoiceGender): readonly string[] {
  return gender === "female" ? COSY_FEMALE_VOICES : COSY_MALE_VOICES;
}

export function voiceMatchesGender(
  voiceId: string,
  gender: VoiceGender,
  provider: "xai" | "siliconflow" = "xai",
): boolean {
  const pool =
    provider === "siliconflow"
      ? cosyVoicesForGender(gender)
      : xaiVoicesForGender(gender);
  const normalized = voiceId.trim().toLowerCase();
  return pool.some((candidate) => candidate.toLowerCase() === normalized);
}

export function pickGenderedVoice(input: {
  employeeId: string;
  gender: VoiceGender;
  provider: "xai" | "siliconflow";
  preferredVoiceId?: string | null;
}): string {
  const pool =
    input.provider === "siliconflow"
      ? cosyVoicesForGender(input.gender)
      : xaiVoicesForGender(input.gender);
  if (
    input.preferredVoiceId &&
    voiceMatchesGender(input.preferredVoiceId, input.gender, input.provider)
  ) {
    return input.preferredVoiceId;
  }
  let hash = 0;
  const seed = `${input.employeeId}:${input.gender}:${input.provider}`;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return pool[hash % pool.length] ?? pool[0]!;
}
