# Payment matching evaluation

Sample statement: 9 rows, 0 parse errors. Each row is compared with what a human accountant would decide.
The statement was written by the author of the engine, so this shows designed behaviour on a mixed file, not accuracy on real statements.

| # | Narration | Human decision | System | Suggested flat | Auto-postable | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Maintenance (swati.j@ybl) | post to T12-0408 | EXACT | T12-0408 | yes | correct flat |
| 2 | Maintenance (swati.j@ybl) | do not post | LIKELY / duplicate | T12-0408 | no | held for a human |
| 3 | Society maintenance  | post to T09-0302 | EXACT | T09-0302 | yes | correct flat |
| 4 | Maintenance (anita.r@okicici) | post to T10-0605 | EXACT | T10-0605 | yes | correct flat |
| 5 | Part payment (aamir.s@okhdfcbank) | post to T21-1601 | LIKELY / partial | T21-1601 | no | correct flat |
| 6 | Two months in advance  | post to T05-0702 | LIKELY / two_month | T05-0702 | no | correct flat |
| 7 | Transfer (unknown.person@ybl) | do not post | UNCLEAR / no_identity | - | no | held for a human |
| 8 | Cash deposit  | do not post | UNCLEAR / no_identity | - | no | held for a human |
| 9 | Maintenance (neeraj.k@okaxis) | do not post | LIKELY / already_paid | T07-1203 | no | held for a human |

| Measure | Result |
| --- | --- |
| Rows wrongly auto-postable (target: 0) | 0 of 9 |
| Rows a human would post where the right flat was suggested | 5 of 5 |
| Rows a human would hold that the system held | 4 of 4 |
| Rows the system would post in one click (EXACT) | 3 of 9 |
