$(document).on("submit", "#add-command form", function(e) {
	e.preventDefault();

	const $form 		= $(this);

	const id 			= parseInt($form.find("[name=id]").val(), 10);
	const name 			= $form.find("[name=name]").val();
	const type 			= $form.find("[name=type]").val();
	const content 		= $form.find("[name=content]").val();

	socket.once("command.add", (data) => {
		$form.find(":input").prop("disabled", false);

		if (data.error) {
			return bootbox.alert(data.error);
		}

		$form.find("input").val("");

		$("#nav-commands .list-group").append(renderTemplate("partials/command", { cmd: data }, true));

		bootbox.alert("Command successfully added!");
	});

	socket.emit("command.add", { id, name, type, content });
});

$(document).on("click", ".bot-command [data-type=remove]", function(e) {
	e.preventDefault();

	const $command 		= $(this).parents(".bot-command");

	const command 		= $command.attr("data-command");
	const id 			= $command.attr("data-id");

	bootbox.confirm("Are you sure you want to remove <em>!" + command + "</em>?", function(result) {
		if (!result) {
			return false;
		}

		socket.once("command.remove", (data) => {
			if (data.error) {
				return bootbox.alert(data.error);
			}

			bootbox.alert("Command successfully removed!");

			$command.remove();
		});

		socket.emit("command.remove", parseInt(id, 10));
	});
});