/**
 * Opquast rules definitions.
 *
 * Each rule is a mapping from rule ID to test expression.
 * Test expressions use schemes like `oqs@functionName`, `xpath@...`, etc.
 */

import rulesData from '../data/rules.json' with { type: 'json' };

export default rulesData as Record<string, string>;
