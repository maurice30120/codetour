import Ajv from "ajv";
import draft04MetaSchema from "ajv/lib/refs/json-schema-draft-04.json";
import codetourSchema from "../schema.json";

const ajv = new Ajv({ allErrors: true, meta: false, schemaId: "id" });
ajv.addMetaSchema(draft04MetaSchema);

export const validateCodetourTour = ajv.compile(codetourSchema);
