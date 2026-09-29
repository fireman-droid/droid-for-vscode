; Vendored from Kilo 7d977bce994af36f0edf752cb53e3aefc7aeb214; Continue Apache-2.0; see third-party/CONTINUE-LICENSE.txt.
; Definitions

; * modules and protocols
(call
  target: (identifier) @ignore
  (arguments (alias) @name.definition.module)
  (#match? @ignore "^(defmodule|defprotocol)$")) @definition.module

; * functions/macros
(call
  target: (identifier) @ignore
  (arguments
    [
      ; zero-arity functions with no parentheses
      (identifier) @name.definition.function
      ; regular function clause
      (call target: (identifier) @name.definition.function)
      ; function clause with a guard clause
      (binary_operator
        left: (call target: (identifier) @name.definition.function)
        operator: "when")
    ])
  (#match? @ignore "^(def|defp|defdelegate|defguard|defguardp|defmacro|defmacrop|defn|defnp)$")) @definition.function

; * modules
(alias) @name.reference.module @reference.module
