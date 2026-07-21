"use client";

import React from "react";

export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(event) => {
    props.onChange?.(event);
    event.currentTarget.form?.requestSubmit();
  }} />;
}
