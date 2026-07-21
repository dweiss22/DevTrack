import React from "react";
import sanitizeHtml from "sanitize-html";

const DESCRIPTION_TAGS = ["a", "br", "p", "div", "ul", "ol", "li", "strong", "b", "em", "i", "u", "blockquote", "h3", "h4"];

export function sanitizeWrikeDescription(description: string) {
  return sanitizeHtml(description, {
    allowedTags: DESCRIPTION_TAGS,
    allowedAttributes: { a: ["href", "title", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: "a",
        attribs: {
          ...(attributes.href ? { href: attributes.href } : {}),
          ...(attributes.title ? { title: attributes.title } : {}),
          target: "_blank",
          rel: "noopener noreferrer"
        }
      })
    }
  });
}

export function ProjectDescription({ description }: { description: string }) {
  const safeDescription = sanitizeWrikeDescription(description);
  if (!safeDescription.trim()) return null;
  return <div className="project-overview-description" dangerouslySetInnerHTML={{ __html: safeDescription }} />;
}
