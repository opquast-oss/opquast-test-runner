/**
 * Opquast rulesets (criteria) definitions.
 *
 * Each ruleset defines a combination of rules and their expected results
 * that together evaluate a quality criterion.
 */

import rulesetsData from '../data/rulesets.json' with { type: 'json' };

export default rulesetsData as Record<string, unknown>;
