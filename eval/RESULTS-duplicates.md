# Duplicate detection evaluation

45 labelled pairs (22 same incident worded differently, 23 same category but a different problem), English, Hindi and Marathi, 16 of them across languages.
The threshold is chosen on the 24 dev pairs and reported on the 21 held-out test pairs. Embedding model: gemini-embedding-001. The pairs were written by the author of the system, so the numbers are an optimistic bound.

| Method (threshold) | Test precision | Test recall | Test F1 | Wrong links | Missed duplicates |
| --- | --- | --- | --- | --- | --- |
| Word overlap, previous setting (0.34) | 50% | 10% | 17% | 1 | 9 |
| Word overlap, tuned on dev (0.14) | 50% | 30% | 37% | 3 | 7 |
| Embeddings, tuned on dev (0.95) | 100% | 80% | 89% | 0 | 2 |

Recall on true duplicates in the test half: across languages (7 pairs) word overlap 0%, embeddings 71%; same language (3 pairs) word overlap 33%, embeddings 100%.

Chosen embedding threshold: 0.95. Score ranges on all pairs: duplicates 0.83 to 0.98, non-duplicates 0.77 to 0.92.

Embedding mistakes on the test half:
- missed (0.83): "The staircase is very dirty" / "जिना खूप घाणेरडा आहे"
- missed (0.95): "Water is leaking from the terrace into the top floor flats" / "छतावरून पाणी गळून वरच्या मजल्यावरील फ्लॅटमध्ये येत आहे"
