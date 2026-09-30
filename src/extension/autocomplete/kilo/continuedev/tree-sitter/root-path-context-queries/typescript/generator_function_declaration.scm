; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
; Pattern for return type with direct type_identifier
(
  (generator_function_declaration
    (type_annotation
      (type_identifier) @return_type
    )
  )
)

; Pattern for return type with one level of nesting
(
  (generator_function_declaration
    (type_annotation
      (_
        (type_identifier) @return_type
      )
    )
  )
)

; Pattern for return type with two levels of nesting
(
  (generator_function_declaration
    (type_annotation
      (_
        (_
          (type_identifier) @return_type
        )
      )
    )
  )
)

; Pattern for parameters with direct type_identifier
(
  (generator_function_declaration
    (formal_parameters
      (_
        (type_annotation
          (type_identifier) @param_type
        )
      )
    )
  )
)

; Pattern for parameters with one level of nesting
(
  (generator_function_declaration
    (formal_parameters
      (_
        (type_annotation
          (_
            (type_identifier) @param_type
          )
        )
      )
    )
  )
)

; Pattern for parameters with two levels of nesting
(
  (generator_function_declaration
    (formal_parameters
      (_
        (type_annotation
          (_
            (_
              (type_identifier) @param_type
            )
          )
        )
      )
    )
  )
)