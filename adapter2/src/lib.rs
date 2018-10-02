#![feature(try_trait)]
#![feature(fnbox)]
#![feature(nll)]
#![feature(slice_concat_ext)]
#![allow(unused)]

#[macro_use]
extern crate serde_derive;
extern crate serde;
#[macro_use]
extern crate serde_json;
#[macro_use]
extern crate failure_derive;
#[macro_use]
extern crate lazy_static;
extern crate debug_protocol as raw_debug_protocol;
extern crate failure;
extern crate lldb;
#[macro_use]
extern crate log;
extern crate bytes;
extern crate clap;
extern crate env_logger;
extern crate globset;
extern crate regex;
extern crate superslice;

extern crate futures;
extern crate tokio;
extern crate tokio_threadpool;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

use std::net;

use clap::{App, Arg, SubCommand};

use futures::prelude::*;
use tokio::prelude::*;

use futures::future::{lazy, poll_fn};
use futures::sync::mpsc;
use tokio::codec::Decoder;
use tokio::io;
use tokio::net::TcpListener;
use tokio_threadpool::blocking;

use lldb::*;

mod cancellation;
mod debug_protocol;
mod debug_session;
mod disassembly;
mod error;
mod expressions;
mod handles;
mod must_initialize;
mod python;
mod source_map;
mod stdio_channel;
mod terminal;
mod wire_protocol;

macro_rules! extract {
    ($compound:ident => $pattern:pat => $vars:expr) => {
        match $compound {
            $pattern => $vars,
            _ => unreachable!(),
        }
    };
}

#[no_mangle]
pub extern "C" fn entry(args: &[&str]) {
    env_logger::Builder::from_default_env().init();
    SBDebugger::initialize();

    let matches = App::new("codelldb")
        .arg(Arg::with_name("multi-session").long("multi-session"))
        .arg(Arg::with_name("port").long("port").takes_value(true))
        .get_matches_from(args);

    let multi_session = matches.is_present("multi-session");
    let port = matches
        .value_of("port") //
        .map(|s| s.parse().unwrap())
        .unwrap_or(0);

    let localhost = net::Ipv4Addr::new(127, 0, 0, 1);
    let addr = net::SocketAddr::new(localhost.into(), port);
    let listener = TcpListener::bind(&addr).unwrap();

    println!("Listening on port {}", listener.local_addr().unwrap().port());

    let server = listener.incoming().map_err(|err| {
        error!("accept error: {:?}", err);
        panic!()
    });

    let server: Box<Stream<Item = _, Error = _> + Send> = if !multi_session {
        Box::new(server.take(1))
    } else {
        Box::new(server)
    };

    let server = server
        .for_each(|conn| {
            conn.set_nodelay(true);
            run_debug_session(conn)
        })
        .then(|r| {
            info!("### server resolved: {:?}", r);
            Ok(())
        });

    tokio::run(server);
    debug!("### Exiting");
    #[cfg(not(windows))]
    SBDebugger::terminate();
}

fn run_debug_session(
    stream: impl AsyncRead + AsyncWrite + Send + 'static,
) -> impl Future<Item = (), Error = io::Error> {
    future::lazy(|| {
        debug!("New debug session");

        let (to_client, from_client) = wire_protocol::Codec::new().framed(stream).split();
        let (to_session, from_session) = debug_session::DebugSession::new().split();

        let client_to_session = from_client
            .map_err(|_| ()) //.
            .forward(to_session)
            .then(|r| {
                info!("### client_to_session stream terminated");
                Ok(())
            });
        tokio::spawn(client_to_session);

        let session_to_client = from_session
            .map_err(|err| io::Error::new(io::ErrorKind::Other, "DebugSession error"))
            .forward(to_client)
            .then(|r| {
                debug!("### session_to_client stream terminated");
                Ok(())
            });

        session_to_client
    })
}
