import Ajv from "ajv";
import draft04MetaSchema from "ajv/lib/refs/json-schema-draft-04.json";
import codetourSchema from "../schema.json";

// Validation de la sortie contre le schéma CodeTour général (draft-04) : le
// serveur applique son schéma d'entrée plus strict, puis garantit que le
// fichier produit reste compatible avec le consommateur existant.
const ajv = new Ajv({ allErrors: true, meta: false, schemaId: "id" });
ajv.addMetaSchema(draft04MetaSchema);

export const validateCodetourTour = ajv.compile(codetourSchema);
