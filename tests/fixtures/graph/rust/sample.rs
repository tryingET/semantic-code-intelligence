use std::collections::HashMap;

pub struct Widget {
    values: HashMap<String, String>,
}

pub enum Mode {
    Compact,
}

pub trait Renderable {
    fn render(&self) -> String;
}

impl Widget {
    pub fn render(&self) -> String {
        helper();
        self.draw();
        println!("rendering");
        String::from("ok")
    }

    fn draw(&self) {}
}

fn helper() {}
