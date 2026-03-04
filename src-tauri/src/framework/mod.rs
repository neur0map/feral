pub mod charm;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framework {
    Charm,
}

pub fn from_str(s: &str) -> Framework {
    match s {
        "charm" => Framework::Charm,
        _ => Framework::Charm, // backward-compat default
    }
}

pub fn feralkit_source(fw: Framework) -> &'static str {
    match fw {
        Framework::Charm => charm::FERALKIT_SOURCE,
    }
}

pub fn go_dependencies(fw: Framework) -> &'static [&'static str] {
    match fw {
        Framework::Charm => charm::GO_DEPENDENCIES,
    }
}

pub fn harness_source(fw: Framework, module: &str, screen_name: &str) -> String {
    match fw {
        Framework::Charm => charm::harness_source(module, screen_name),
    }
}

pub fn full_app_template(
    fw: Framework,
    imports: &str,
    enum_lines: &str,
    new_screen_cases: &str,
    route_cases: &str,
    start_pascal: &str,
    module_path: &str,
) -> String {
    match fw {
        Framework::Charm => charm::full_app_template(
            imports,
            enum_lines,
            new_screen_cases,
            route_cases,
            start_pascal,
            module_path,
        ),
    }
}

pub fn ai_system_prompt(
    fw: Framework,
    screen_name: &str,
    target_file: &str,
    context_section: &str,
) -> String {
    match fw {
        Framework::Charm => charm::ai_system_prompt(screen_name, target_file, context_section),
    }
}
