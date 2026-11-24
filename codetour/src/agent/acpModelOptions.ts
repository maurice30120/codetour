import type * as acp from "@agentclientprotocol/sdk";

/**
 * The model selector an ACP session announces among its configuration
 * options (ADR 0048): which option carries it, the values it offers and the
 * value the agent confirms as effective.
 *
 * This is the one place that reads the ACP shape of a model option, shared by
 * the session layer and the Agent Selection that lists the values the reader
 * may pick.
 */

/** One model value an agent offers. */
export interface AcpModelValue {
  /** The value identifier sent back in `session/set_config_option`. */
  value: string;
  /** The value's label, as the agent spells it. */
  name: string;
}

/** The model selector of a session, with the value the agent confirms. */
export interface AcpModelSelector {
  /** The configuration option id `session/set_config_option` targets. */
  optionId: string;
  /** The model the agent confirms as effective right now. */
  value: string;
  /** Every value the agent offers, groups flattened. */
  values: AcpModelValue[];
}

/**
 * The model selector of a session's configuration options, or undefined when
 * the agent announces no model at all.
 *
 * Only an option whose `category` is `model` — or whose id is `model` when its
 * category is absent — is a model selector: a model configuration option and a
 * thought level are other options, and a boolean toggle carries no model
 * value. The selectable values may be grouped; the groups are flattened.
 */
export function findModelSelector(
  options: readonly acp.SessionConfigOption[] | null | undefined
): AcpModelSelector | undefined {
  const option = options?.find(isModelOption);
  if (!option || option.type !== "select") {
    return undefined;
  }
  return {
    optionId: option.id,
    value: option.currentValue,
    values: flattenValues(option.options)
  };
}

function isModelOption(option: acp.SessionConfigOption): boolean {
  return (
    option.type === "select" &&
    (option.category === "model" || (!option.category && option.id === "model"))
  );
}

function flattenValues(
  options: acp.SessionConfigSelectOptions
): AcpModelValue[] {
  const entries = options as readonly (
    | acp.SessionConfigSelectOption
    | acp.SessionConfigSelectGroup
  )[];
  return entries.flatMap(entry =>
    "group" in entry ? entry.options.map(toModelValue) : [toModelValue(entry)]
  );
}

function toModelValue(option: acp.SessionConfigSelectOption): AcpModelValue {
  return { value: option.value, name: option.name };
}
