import { createGraphQLClient } from "../shared/graphqlClient";
import type { DesignElementInput as SchemaDesignElementInput } from "./api-schema-types.generated";
import type {
  DesignFieldsFragment,
  TemplateFieldsFragment,
  DesignsQuery,
  DesignQuery,
  SaveDesignMutation,
  DeleteDesignMutation,
  TemplatesQuery,
  TemplatesQueryVariables,
  SaveAsTemplateMutation,
  GenerateDesignElementsMutation,
  GenerateDesignElementsMutationVariables,
} from "./api.generated";

// Separate endpoint, separate service, same reasoning as pantry/imposter's
// api.ts - optional chaining on `env` because api/scripts/validate-schemas.ts
// requires this module from plain Node/tsx (no Vite, so import.meta.env
// doesn't exist there) purely to validate the query strings below.
export const DESIGN_STUDIO_ENDPOINT = import.meta.env?.VITE_DESIGN_STUDIO_GRAPHQL_ENDPOINT as
  string | undefined;

export const runDesignStudioQuery = createGraphQLClient(
  DESIGN_STUDIO_ENDPOINT,
  "VITE_DESIGN_STUDIO_GRAPHQL_ENDPOINT"
);

export type Design = DesignFieldsFragment;
export type DesignElementInput = SchemaDesignElementInput;

const DESIGN_FIELDS = /* GraphQL */ `
  fragment DesignFields on Design {
    id
    name
    width
    height
    createdAt
    updatedAt
    elements {
      id
      type
      x
      y
      width
      height
      rotation
      zIndex
      fill
      stroke
      strokeWidth
      text
      fontFamily
      fontSize
      fontWeight
    }
  }
`;

export const DESIGNS_QUERY = /* GraphQL */ `
  query Designs {
    designs {
      ...DesignFields
    }
  }
  ${DESIGN_FIELDS}
`;

export const DESIGN_QUERY = /* GraphQL */ `
  query Design($id: ID!) {
    design(id: $id) {
      ...DesignFields
    }
  }
  ${DESIGN_FIELDS}
`;

export const SAVE_DESIGN_MUTATION = /* GraphQL */ `
  mutation SaveDesign($input: SaveDesignInput!) {
    saveDesign(input: $input) {
      ...DesignFields
    }
  }
  ${DESIGN_FIELDS}
`;

export const DELETE_DESIGN_MUTATION = /* GraphQL */ `
  mutation DeleteDesign($id: ID!) {
    deleteDesign(id: $id)
  }
`;

export type Template = TemplateFieldsFragment;

const TEMPLATE_FIELDS = /* GraphQL */ `
  fragment TemplateFields on Template {
    id
    name
    category
    tags
    colors
    popularity
    width
    height
    elements {
      id
      type
      x
      y
      width
      height
      rotation
      zIndex
      fill
      stroke
      strokeWidth
      text
      fontFamily
      fontSize
      fontWeight
    }
  }
`;

export const TEMPLATES_QUERY = /* GraphQL */ `
  query Templates($search: String, $category: String, $tags: [String!], $color: String) {
    templates(search: $search, category: $category, tags: $tags, color: $color) {
      ...TemplateFields
    }
  }
  ${TEMPLATE_FIELDS}
`;

export const SAVE_AS_TEMPLATE_MUTATION = /* GraphQL */ `
  mutation SaveAsTemplate($input: SaveAsTemplateInput!) {
    saveAsTemplate(input: $input) {
      ...TemplateFields
    }
  }
  ${TEMPLATE_FIELDS}
`;

export async function listDesigns(): Promise<Design[]> {
  const data = await runDesignStudioQuery<DesignsQuery>(DESIGNS_QUERY);

  return data.designs;
}

export async function getDesign(id: string): Promise<Design | null> {
  const data = await runDesignStudioQuery<DesignQuery>(DESIGN_QUERY, { id });

  return data.design ?? null;
}

export interface SaveDesignArgs {
  id?: string | null;
  name: string;
  width: number;
  height: number;
  elements: DesignElementInput[];
}

export async function saveDesign(input: SaveDesignArgs): Promise<Design> {
  const data = await runDesignStudioQuery<SaveDesignMutation>(SAVE_DESIGN_MUTATION, { input });

  return data.saveDesign;
}

export async function deleteDesign(id: string): Promise<boolean> {
  const data = await runDesignStudioQuery<DeleteDesignMutation>(DELETE_DESIGN_MUTATION, { id });

  return data.deleteDesign;
}

export async function listTemplates(filter: TemplatesQueryVariables = {}): Promise<Template[]> {
  const data = await runDesignStudioQuery<TemplatesQuery>(TEMPLATES_QUERY, filter);

  return data.templates;
}

export interface SaveAsTemplateArgs {
  name: string;
  category: string;
  tags: string[];
  width: number;
  height: number;
  elements: DesignElementInput[];
}

export async function saveAsTemplate(input: SaveAsTemplateArgs): Promise<Template> {
  const data = await runDesignStudioQuery<SaveAsTemplateMutation>(SAVE_AS_TEMPLATE_MUTATION, { input });

  return data.saveAsTemplate;
}

export const GENERATE_DESIGN_ELEMENTS_MUTATION = /* GraphQL */ `
  mutation GenerateDesignElements($prompt: String!, $width: Float!, $height: Float!) {
    generateDesignElements(prompt: $prompt, width: $width, height: $height) {
      id
      type
      x
      y
      width
      height
      rotation
      zIndex
      fill
      stroke
      strokeWidth
      text
      fontFamily
      fontSize
      fontWeight
    }
  }
`;

export async function generateDesignElements(
  args: GenerateDesignElementsMutationVariables
): Promise<Design["elements"]> {
  const data = await runDesignStudioQuery<GenerateDesignElementsMutation>(
    GENERATE_DESIGN_ELEMENTS_MUTATION,
    args
  );

  return data.generateDesignElements;
}
