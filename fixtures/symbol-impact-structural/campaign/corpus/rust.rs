pub struct PublicRustType {
    pub value: i32,
}

pub fn public_rust_function() -> i32 { 1 }

struct InternalRustType;

impl InternalRustType {
    fn internal_rust_method(&self) -> i32 { 1 }
}
