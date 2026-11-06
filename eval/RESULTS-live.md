# Complaint classifier evaluation

Set: 66 complaints (40 ordinary, 20 safety, 6 lookalikes that should not escalate). Languages: en 34, hi 17, mr 15.
The set was written by the author of the rules, so the numbers are an optimistic bound.

## Rules classifier (no model)

| Measure | Result |
| --- | --- |
| Category accuracy, all ordinary | 32/40 (80.0%) |
| Category accuracy, en | 17/20 |
| Category accuracy, hi | 8/10 |
| Category accuracy, mr | 7/10 |
| Safety recall (escalated by rule) | 20/20 (100.0%) |
| Safety recall, en (incl. Roman script under hi) | 8/8 |
| Safety recall, hi (incl. Roman script under hi) | 7/7 |
| Safety recall, mr (incl. Roman script under hi) | 5/5 |
| False escalations on ordinary and lookalike | 2/46 |

Category misses (rules):
- [hi] "सिंक के नीचे से पानी रिस रहा है" expected PLUMBING, got OTHER
- [mr] "बाहेरचे लोक विनापरवानगी आत येत आहेत" expected SECURITY, got OTHER
- [en] "Dustbins near tower 4 are overflowing and attracting flies" expected HOUSEKEEPING, got PLUMBING
- [mr] "रॅम्पवर दुचाकी लावल्याने गाड्या जाऊ शकत नाहीत" expected PARKING, got OTHER
- [en] "Water comes out very weakly on the 15th floor" expected WATER_SUPPLY, got OTHER
- [hi] "हमारे नल में दो दिन से पानी नहीं आ रहा" expected WATER_SUPPLY, got PLUMBING
- [mr] "पाण्याचा दाब खूप कमी आहे" expected WATER_SUPPLY, got OTHER
- [en] "The park near tower 12 has not been mowed and the grass is knee high" expected GARDEN, got PARKING

False escalations (kept on purpose: a wrong escalation costs a phone call, a missed one can cost a life):
- [en] "The fire extinguisher in tower 2 is past its expiry date"
- [en] "The smoke detector in our corridor beeps for a battery change"

## Full pipeline with live models (gemini then groq, then rules)

| Measure | Result |
| --- | --- |
| Category accuracy, all ordinary | 40/40 (100.0%) |
| Answered by | gemini 20, groq 20 |
| Flagged "needs review" | 0 |
| Safety complaints escalated end to end | 20/20 (100.0%) |

Models: gemini-2.5-flash-lite, openai/gpt-oss-120b.
