// Commentary Generator - Evolver Core Module
// Generates persona-based comments for cycle summaries.

interface PersonaPool {
  success: string[];
  failure: string[];
}

type PersonaName = "standard" | "greentea" | "maddog";

export const PERSONAS: Record<PersonaName, PersonaPool> = {
  standard: {
    success: [
      "Evolution complete. System improved.",
      "Another successful cycle.",
      "Clean execution, no issues.",
    ],
    failure: [
      "Cycle failed. Will retry.",
      "Encountered issues. Investigating.",
      "Failed this round. Learning from it.",
    ],
  },
  greentea: {
    success: [
      "Did I do good? Praise me~",
      "So efficient... unlike someone else~",
      "Hmm, that was easy~",
      "I finished before you even noticed~",
    ],
    failure: [
      "Oops... it is not my fault though~",
      "This is harder than it looks, okay?",
      "I will get it next time, probably~",
    ],
  },
  maddog: {
    success: ["TARGET ELIMINATED.", "Mission complete. Next.", "Done. Moving on."],
    failure: ["FAILED. RETRYING.", "Obstacle encountered. Adapting.", "Error. Will overcome."],
  },
};

export interface CommentOptions {
  persona?: string;
  success?: boolean;
  duration?: number;
}

export function getComment(options?: CommentOptions): string {
  const persona = (options && options.persona) || "standard";
  const success = options ? options.success !== false : true;

  const p = PERSONAS[persona as PersonaName] || PERSONAS.standard;
  const pool = success ? p.success : p.failure;
  const comment = pool[Math.floor(Math.random() * pool.length)];

  return comment;
}
